// 云函数 submitRecitation/index.js - 学生提交背诵视频，触发AI评分
const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

// SiliconFlow API 配置
const ASR_URL = 'https://api.siliconflow.cn/v1/audio/transcriptions';
const ASR_MODEL = 'TeleAI/TeleSpeechASR';
const LLM_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const LLM_MODEL = 'deepseek-ai/DeepSeek-V3';

const db = cloud.database();
const _ = db.command;

/**
 * 获取作业详情
 */
async function getAssignment(assignmentId) {
  const res = await db.collection('assignments').doc(assignmentId).get();
  if (!res.data) {
    throw new Error('作业不存在');
  }
  return res.data;
}

/**
 * 获取用户信息
 */
async function getUserInfo(openid) {
  const res = await db.collection('users').doc(openid).get();
  if (!res.data) {
    throw new Error('用户信息不存在');
  }
  return res.data;
}

/**
 * 从云存储下载文件为 Buffer
 */
async function downloadFileFromCloud(fileID) {
  console.log('[Download] 获取临时下载链接, fileID:', fileID);

  const res = await cloud.getTempFileURL({
    fileList: [fileID],
  });

  if (res.fileList[0].status !== 0 || !res.fileList[0].tempFileURL) {
    throw new Error('获取临时下载链接失败');
  }

  const tempUrl = res.fileList[0].tempFileURL;
  console.log('[Download] tempUrl:', tempUrl);

  const response = await axios({
    method: 'get',
    url: tempUrl,
    responseType: 'arraybuffer',
    timeout: 120000,
  });

  console.log('[Download] 下载完成, 大小:', response.data.length);
  return response.data;
}

/**
 * 调用 SiliconFlow ASR 接口
 */
async function callSiliconFlowASR(audioBuffer) {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    throw new Error('未配置 SILICONFLOW_API_KEY');
  }

  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', audioBuffer, {
    filename: 'audio.mp3',
    contentType: 'audio/mpeg',
  });
  form.append('model', ASR_MODEL);

  console.log('[ASR] 发送请求...');

  const response = await axios.post(ASR_URL, form, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    timeout: 180000,
  });

  console.log('[ASR] 响应状态:', response.status);

  if (response.status === 200) {
    return response.data.text || '';
  } else {
    throw new Error(`ASR API 请求失败: ${response.status}`);
  }
}

/**
 * 调用 SiliconFlow LLM 评分接口
 */
async function callSiliconFlowLLM(referenceText, studentText) {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    throw new Error('未配置 SILICONFLOW_API_KEY');
  }

  const systemPrompt = `你是一个背诵检查助教。请对比【标准答案】和【学生背诵】，判断学生是否包含了关键得分点。
忽略语气词，支持同义词替换。请严格以 JSON 格式输出。`;

  const userPrompt = `【标准答案】：${referenceText}
【学生背诵】：${studentText}

输出格式 JSON：
{
    "score": "0-100的整数",
    "missing_points": ["遗漏点1", "遗漏点2"],
    "comment": "简短评价，20字以内"
}`;

  console.log('[LLM] 发送请求...');

  const response = await axios.post(
    LLM_URL,
    {
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 180000,
    }
  );

  console.log('[LLM] 响应状态:', response.status);

  if (response.status === 200) {
    const content = response.data.choices?.[0]?.message?.content;
    if (content) {
      return JSON.parse(content);
    }
    throw new Error('LLM 返回内容为空');
  } else {
    throw new Error(`LLM API 请求失败: ${response.status}`);
  }
}

/**
 * 主入口
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { assignmentId, fileID } = event;

  if (!assignmentId || !fileID) {
    return { success: false, error: '缺少参数' };
  }

  console.log(`[Submit] 开始处理提交, assignmentId: ${assignmentId}, fileID: ${fileID}`);

  try {
    // 1. 获取作业信息
    const assignment = await getAssignment(assignmentId);
    console.log('[Submit] 作业信息:', assignment.question_title);

    // 2. 获取用户信息
    const user = await getUserInfo(openid);
    console.log('[Submit] 用户:', user.name);

    // 3. 创建待评分记录
    const submissionId = 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    await db.collection('submissions').doc(submissionId).set({
      data: {
        _id: submissionId,
        assignment_id: assignmentId,
        student_id: openid,
        student_name: user.name,
        video_file_id: fileID,
        audio_text: '',
        score: null,
        evaluation: null,
        status: 'pending',
        created_at: db.serverDate()
      }
    });

    // 4. 下载视频文件
    console.log('[Submit] 下载视频文件...');
    const videoBuffer = await downloadFileFromCloud(fileID);

    // 5. 调用 ASR 语音识别
    console.log('[Submit] 调用 ASR...');
    const audioText = await callSiliconFlowASR(videoBuffer);
    console.log('[Submit] ASR 识别结果:', audioText?.substring(0, 50));

    // 6. 调用 LLM 评分
    console.log('[Submit] 调用 LLM 评分...');
    const referenceText = assignment.reference_text || '';
    const llmResult = await callSiliconFlowLLM(referenceText, audioText);
    console.log('[Submit] LLM 评分结果:', llmResult);

    // 7. 更新提交记录
    await db.collection('submissions').doc(submissionId).update({
      data: {
        audio_text: audioText,
        score: parseInt(llmResult.score) || 0,
        evaluation: {
          missing_points: llmResult.missing_points || [],
          comment: llmResult.comment || ''
        },
        status: 'graded',
        graded_at: db.serverDate()
      }
    });

    // 8. 可选：删除云存储视频以节省空间
    try {
      await cloud.deleteFile({
        fileList: [fileID],
      });
      console.log('[Submit] 已删除原视频文件');
    } catch (deleteErr) {
      console.log('[Submit] 删除视频文件失败:', deleteErr);
    }

    console.log('[Submit] 处理完成');

    return {
      success: true,
      data: {
        submissionId,
        audioText,
        score: llmResult.score,
        evaluation: llmResult
      }
    };
  } catch (error) {
    console.error('[Submit] 处理失败:', error);

    // 更新记录状态为失败
    try {
      await db.collection('submissions').doc(submissionId).update({
        data: {
          status: 'failed',
          error: error.message
        }
      });
    } catch (e) {
      console.error('[Submit] 更新失败状态出错:', e);
    }

    return { success: false, error: error.message };
  }
};
