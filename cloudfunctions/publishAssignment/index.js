// 云函数 publishAssignment/index.js - 老师发布作业（从CSV/Excel文件解析）
//
// 入参：
//   { classId, className, fileContent, fileType, batchTitle }
//   - batchTitle: 本次作业的名字（必填，<=30 字符）
//
// 流程：
//   1. 校验老师对该班级的所有权
//   2. 校验 batchTitle 非空
//   3. 解析 CSV/Excel
//   4. 先创建一条 assignment_batches 记录
//   5. 循环 add assignment 时写入 batch_id（反查指向）
//   6. 更新 batch 的 assignment_ids + assignment_count
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
  const { classId, fileContent, className, fileType, batchTitle } = event;

  // ===== 1. 校验作业名（必填） =====
  const cleanTitle = (batchTitle || '').trim();
  if (!cleanTitle) {
    return { success: false, error: '请填写本次作业的名字' };
  }
  if (cleanTitle.length > 30) {
    return { success: false, error: '作业名不能超过 30 个字符' };
  }

  try {
    // ===== 2. 验证班级归属 =====
    const classRes = await db.collection('classes')
      .where({ _id: classId, teacher_id: openid })
      .get();

    if (classRes.data.length === 0) {
      return { success: false, error: '班级不存在或您不是该班级的老师' };
    }

    const classInfo = classRes.data[0];

    // ===== 3. 解析文件 =====
    let lines;
    if (fileType === 'excel') {
      lines = parseExcelContent(fileContent);
    } else {
      lines = parseCSVContent(fileContent);
    }

    if (!lines || lines.length === 0) {
      return { success: false, error: '文件解析为空，请检查文件内容' };
    }

    // ===== 4. 创建 batch 记录 =====
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const batchDoc = {
      _id: batchId,
      class_id: classId,
      class_name: className || classInfo.name,
      teacher_id: openid,
      teacher_name: classInfo.teacher_name || '',
      title: cleanTitle,
      assignment_ids: [],
      assignment_count: 0,
      status: 'active',
      created_at: new Date(),
      deleted_at: null
    };
    await db.collection('assignment_batches').add({ data: batchDoc });

    // ===== 5. 循环 add assignment =====
    const createdIds = [];
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

      // 解析截止时间（北京时间 +08:00）
      let deadline;
      const dateMatch = deadlineStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s*(\d{1,2}):(\d{2}))?/);
      if (dateMatch) {
        const [, year, month, day, hour = '23', minute = '59'] = dateMatch;
        const localStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00+08:00`;
        deadline = new Date(localStr);
      } else {
        deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      }

      const assignmentId = `assign_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 6)}`;

      await db.collection('assignments').add({
        data: {
          _id: assignmentId,
          class_id: classId,
          class_name: className || classInfo.name,
          teacher_id: openid,
          batch_id: batchId,            // ← 反查字段
          question_title,
          reference_text,
          deadline,
          status: 'active',
          created_at: new Date()
        }
      });

      createdIds.push(assignmentId);
      results.push({ success: true, question_title, assignmentId });
    }

    // ===== 6. 回写 batch.assignment_ids + count =====
    if (createdIds.length > 0) {
      await db.collection('assignment_batches').doc(batchId).update({
        data: {
          assignment_ids: createdIds,
          assignment_count: createdIds.length
        }
      });
    } else {
      // 没有创建任何题目，回滚 batch
      await db.collection('assignment_batches').doc(batchId).remove();
    }

    return {
      success: true,
      data: {
        batchId,
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
  content = content.trim();
  content = content.replace(/\n+$/g, '');

  const lines = [];
  let currentLine = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (char === '"') {
      if (inQuotes && content[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentLine.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
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

  if (field || currentLine.length > 0) {
    currentLine.push(field);
    if (currentLine.length > 0 && (currentLine.length > 1 || currentLine[0] !== '')) {
      lines.push(currentLine);
    }
  }

  const cleaned = lines.filter(line => line.some(f => f.trim() !== ''));
  // 跳过表头
  return cleaned.slice(1);
}

// 解析Excel内容（支持包含换行的单元格）
function parseExcelContent(base64Content) {
  const buffer = Buffer.from(base64Content, 'base64');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  const cleaned = data.filter(row => row.some(cell => {
    if (cell === undefined || cell === null) return false;
    if (typeof cell === 'string') return cell.trim() !== '';
    return true;
  }));

  // 跳过表头
  return cleaned.slice(1);
}