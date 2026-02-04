// 云函数 submitRecitation/index.js - 学生提交背诵视频，触发AI评分
const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

// SiliconFlow API 配置
const ASR_URL = 'https://api.siliconflow.cn/v1/audio/transcriptions';
const ASR_MODEL =  'FunAudioLLM/SenseVoiceSmall' // 'TeleAI/TeleSpeechASR';
const LLM_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const LLM_MODEL = 'Qwen/Qwen3-8B';

const db = cloud.database();
const _ = db.command;

// 从环境变量读取最大提交次数
const MAX_SUBMISSIONS = parseInt(process.env.MAX_SUBMISSIONS_PER_ASSIGNMENT) || 0;

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
  const res = await db.collection('users').where({ _openid: openid }).get();
  if (!res.data || res.data.length === 0) {
    throw new Error('用户信息不存在');
  }
  return res.data[0];
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

  try {
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
      throw new Error(`ASR API 请求失败: 状态码 ${response.status}`);
    }
  } catch (error) {
    // 区分不同类型的错误
    if (error.response) {
      // 服务器返回错误状态码
      const status = error.response.status;
      const msg = error.response.data?.message || error.response.statusText;
      console.error('[ASR] API 错误:', status, msg);
      if (status === 403) {
        throw new Error(`ASR API 无权限(403): 请检查 API Key 或账户状态`);
      } else if (status === 401) {
        throw new Error(`ASR API 认证失败(401): API Key 无效`);
      } else if (status === 429) {
        throw new Error(`ASR API 请求过于频繁(429): 请稍后重试`);
      } else {
        throw new Error(`ASR API 错误(${status}): ${msg}`);
      }
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('ASR 请求超时: 服务器响应超过180秒');
    } else {
      throw new Error(`ASR 网络错误: ${error.message}`);
    }
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
  console.log('[LLM] 模型:', LLM_MODEL);
  console.log('[LLM] 标准答案长度:', referenceText.length);
  console.log('[LLM] 学生背诵长度:', studentText.length);

  try {
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
      throw new Error(`LLM API 请求失败: 状态码 ${response.status}`);
    }
  } catch (error) {
    // 区分不同类型的错误
    if (error.response) {
      const status = error.response.status;
      const msg = error.response.data?.message || error.response.statusText;
      const responseData = error.response.data;
      console.error('========== LLM API 错误 ==========');
      console.error('[LLM] 状态码:', status);
      console.error('[LLM] 错误信息:', msg);
      console.error('[LLM] 模型:', LLM_MODEL);
      console.error('[LLM] 响应数据:', JSON.stringify(responseData, null, 2));
      console.error('===================================');
      if (status === 403) {
        throw new Error(`LLM API 无权限(403): 请检查 API Key 或账户状态`);
      } else if (status === 401) {
        throw new Error(`LLM API 认证失败(401): API Key 无效`);
      } else if (status === 429) {
        throw new Error(`LLM API 请求过于频繁(429): 请稍后重试`);
      } else if (status === 400) {
        throw new Error(`LLM API 请求参数错误(400): ${msg}`);
      } else {
        throw new Error(`LLM API 错误(${status}): ${msg}`);
      }
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('LLM 请求超时: 服务器响应超过180秒');
    } else {
      throw new Error(`LLM 网络错误: ${error.message}`);
    }
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

  let submissionId = null;

  try {
    // 1. 获取作业信息
    const assignment = await getAssignment(assignmentId);
    console.log('[Submit] 作业信息:', assignment.question_title);

    // 2. 获取用户信息
    const user = await getUserInfo(openid);
    console.log('[Submit] 用户:', user.name);

    // 3. 检查提交次数限制
    if (MAX_SUBMISSIONS > 0) {
      const countRes = await db.collection('submissions')
        .where({
          assignment_id: assignmentId,
          student_id: openid,
          status: 'graded'
        })
        .count();

      console.log(`[Submit] 已成功提交 ${countRes.total} 次，最大限制 ${MAX_SUBMISSIONS} 次`);

      if (countRes.total >= MAX_SUBMISSIONS) {
        return {
          success: false,
          error: `该作业最多只能提交 ${MAX_SUBMISSIONS} 次，您已达上限`,
          code: 'SUBMISSION_LIMIT_EXCEEDED'
        };
      }
    }

    // 4. 创建待评分记录
    submissionId = 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    await db.collection('submissions').doc(submissionId).set({
      data: {
        assignment_id: assignmentId,
        student_id: openid,
        student_name: user.name,
        video_file_id: fileID,
        audio_text: '',
        score: 0,
        evaluation: {
          missing_points: [],
          comment: ''
        },
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
        evaluation: llmResult,
        maxSubmissions: MAX_SUBMISSIONS
      }
    };
  } catch (error) {
    console.error('[Submit] 处理失败:', error);

    // 更新记录状态为失败
    if (submissionId) {
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
    }

    return { success: false, error: error.message };
  }
};
