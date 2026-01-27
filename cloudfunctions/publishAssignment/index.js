// 云函数 publishAssignment/index.js - 老师发布作业（从CSV/Excel文件解析）
const cloud = require('wx-server-sdk');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const XLSX = require('xlsx');

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { classId, fileContent, className, fileType } = event;

  try {
    // 验证班级是否存在且属于该老师
    const classRes = await db.collection('classes')
      .where({ _id: classId, teacher_id: openid })
      .get();

    if (classRes.data.length === 0) {
      return { success: false, error: '班级不存在或您不是该班级的老师' };
    }

    const classInfo = classRes.data[0];

    // 根据文件类型解析内容
    let lines;
    if (fileType === 'excel') {
      // 解析Excel文件（传入base64编码的buffer）
      lines = parseExcelContent(fileContent);
    } else {
      // 默认解析CSV内容（支持多行引号字段）
      lines = parseCSVContent(fileContent);
    }
    const results = [];

    for (let i = 0; i < lines.length; i++) {
      const fields = lines[i];

      if (fields.length < 3) {
        console.warn(`第 ${i + 1} 行数据不完整，跳过`);
        continue;
      }

      const question_title = fields[0].trim();
      const reference_text = fields[1].trim();
      const deadlineStr = fields[2].trim();

      // 解析截止时间
      let deadline;
      // 支持格式: 2026-06-01, 2026/06/01, 2026-06-01 12:00
      const dateMatch = deadlineStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s*(\d{1,2}):(\d{2}))?/);
      if (dateMatch) {
        const [, year, month, day, hour = '23', minute = '59'] = dateMatch;
        deadline = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00.000Z`);
      } else {
        // 默认设置为30天后
        deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      }

      // 生成作业ID
      const assignmentId = `assign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // 创建作业记录
      const assignment = {
        _id: assignmentId,
        class_id: classId,
        class_name: className || classInfo.name,
        teacher_id: openid,
        question_title,
        reference_text,
        deadline,
        status: 'active',
        created_at: new Date()
      };

      await db.collection('assignments').add({
        data: assignment
      });

      results.push({
        success: true,
        question_title,
        assignmentId
      });
    }

    return {
      success: true,
      data: {
        count: results.length,
        results
      },
      message: `成功发布 ${results.length} 个作业`
    };
  } catch (error) {
    console.error('发布作业失败:', error);
    return { success: false, error: error.message || '发布作业失败' };
  }
};

// 解析整个CSV内容，支持引号内的换行
function parseCSVContent(content) {
  // 数据清洗：移除首尾空白字符和多余的换行
  content = content.trim();

  // 进一步清理：移除内容末尾可能存在的多个连续换行符
  content = content.replace(/\n+$/g, '');

  const lines = [];
  let currentLine = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (char === '"') {
      // 检查是否是转义的引号 ("")
      if (inQuotes && content[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // 字段分隔符
      currentLine.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      // 行结束
      if (char === '\r' && content[i + 1] === '\n') {
        i++;
      }
      currentLine.push(field);
      if (currentLine.length > 0 && (currentLine.length > 1 || currentLine[0] !== '')) {
        lines.push(currentLine);
      }
      currentLine = [];
      field = '';
    } else {
      field += char;
    }
  }

  // 处理最后一行
  if (field || currentLine.length > 0) {
    currentLine.push(field);
    if (currentLine.length > 0 && (currentLine.length > 1 || currentLine[0] !== '')) {
      lines.push(currentLine);
    }
  }

  // 最终清理：移除可能存在的空行（包括全是空白的行）
  return lines.filter(line => {
    // 检查行是否为空（所有字段都是空的或者只有空白字符）
    return line.some(f => f.trim() !== '');
  });
}

// 解析Excel内容（支持包含换行的单元格）
function parseExcelContent(base64Content) {
  // 将base64转换为buffer
  const buffer = Buffer.from(base64Content, 'base64');

  // 读取Excel文件
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  // 获取第一个工作表
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  // 转换为二维数组
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  // 清理数据：移除空行
  return data.filter(row => {
    return row.some(cell => {
      if (cell === undefined || cell === null) return false;
      if (typeof cell === 'string') return cell.trim() !== '';
      return true;
    });
  });
}
