const cloud = require("wx-server-sdk");
const axios = require("axios");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

// SiliconFlow API 配置 (参考 run.py:12-13)
const ASR_URL = "https://api.siliconflow.cn/v1/audio/transcriptions";
const ASR_MODEL = "TeleAI/TeleSpeechASR";

/**
 * 从云存储下载音频文件为 Buffer
 */
async function downloadAudioFromCloud(fileID) {
  console.log("[ASR] 获取临时下载链接, fileID:", fileID);

  const res = await cloud.getTempFileURL({
    fileList: [fileID],
  });

  console.log("[ASR] getTempFileURL result:", JSON.stringify(res));

  if (res.fileList[0].status !== 0 || !res.fileList[0].tempFileURL) {
    throw new Error("获取临时下载链接失败, status: " + res.fileList[0].status);
  }

  const tempUrl = res.fileList[0].tempFileURL;
  console.log("[ASR] tempUrl:", tempUrl);

  // 下载音频文件
  console.log("[ASR] 开始下载音频...");
  const response = await axios({
    method: "get",
    url: tempUrl,
    responseType: "arraybuffer",
    timeout: 60000,
  });

  console.log("[ASR] 下载完成, 大小:", response.data.length);
  return response.data;
}

/**
 * 调用 SiliconFlow ASR 接口 (参考 run.py:57-66)
 */
async function callSiliconFlowASR(audioBuffer) {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  console.log("[ASR] API Key 是否存在:", !!apiKey);

  if (!apiKey) {
    throw new Error("未配置 SILICONFLOW_API_KEY");
  }

  // 构造 multipart/form-data (参考 run.py:59-63)
  const FormData = require("form-data");
  const form = new FormData();
  form.append("file", audioBuffer, {
    filename: "audio.mp3",
    contentType: "audio/mpeg",
  });
  form.append("model", ASR_MODEL);

  console.log("[ASR] 发送请求到:", ASR_URL);
  console.log("[ASR] 模型:", ASR_MODEL);

  const response = await axios.post(ASR_URL, form, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    timeout: 120000,
  });

  console.log("[ASR] 响应状态:", response.status);
  console.log("[ASR] 响应数据:", JSON.stringify(response.data));

  if (response.status === 200) {
    return response.data.text || "";
  } else {
    throw new Error(`API 请求失败: ${response.status}, ${JSON.stringify(response.data)}`);
  }
}

/**
 * 云函数主入口
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const { fileID } = event;

  if (!fileID) {
    return { success: false, error: "缺少 fileID 参数" };
  }

  try {
    console.log(`开始语音识别, fileID: ${fileID}`);

    // 1. 从云存储下载音频
    const audioBuffer = await downloadAudioFromCloud(fileID);
    console.log(`音频下载成功, 大小: ${(audioBuffer.length / 1024).toFixed(2)} KB`);

    // 2. 调用 SiliconFlow API
    const text = await callSiliconFlowASR(audioBuffer);
    console.log(`识别完成: ${text?.substring(0, 50)}...`);

    return {
      success: true,
      data: {
        text: text,
        fileID: fileID,
        timestamp: Date.now(),
      },
    };
  } catch (error) {
    console.error("语音识别失败:", error);
    return { success: false, error: error.message };
  }
};
