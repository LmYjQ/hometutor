const cloud = require("wx-server-sdk");
const axios = require("axios");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

// LLM API 配置 (参考 run.py:16-20)
const LLM_URL = "https://api.siliconflow.cn/v1/chat/completions";
const LLM_MODEL = "Qwen/Qwen3-8B";

/**
 * 调用 SiliconFlow LLM 评分接口 (参考 run.py:106-116)
 */
async function callSiliconFlowLLM(referenceText, studentText) {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  console.log("[LLM] API Key 是否存在:", !!apiKey);

  if (!apiKey) {
    throw new Error("未配置 SILICONFLOW_API_KEY");
  }

  // 系统提示词 (参考 run.py:89-92)
  const systemPrompt = `你是一个背诵检查助教。请对比【标准答案】和【学生背诵】，判断学生是否包含了关键得分点。
忽略语气词，支持同义词替换。请严格以 JSON 格式输出。`;

  // 用户提示词 (参考 run.py:94-104)
  const userPrompt = `【标准答案】：${referenceText}
【学生背诵】：${studentText}

输出格式 JSON：
{
    "score": "0-100",
    "missing_points": ["遗漏点1", "遗漏点2"],
    "comment": "简短评价"
}`;

  console.log("[LLM] 发送请求到:", LLM_URL);
  console.log("[LLM] 模型:", LLM_MODEL);

  try {
    const response = await axios.post(
      LLM_URL,
      {
        model: LLM_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 120000,
      }
    );

    console.log("[LLM] 响应状态:", response.status);
    console.log("[LLM] 响应数据:", JSON.stringify(response.data));

    if (response.status === 200) {
      const content = response.data.choices?.[0]?.message?.content;
      if (content) {
        return JSON.parse(content);
      }
      throw new Error("LLM 返回内容为空");
    } else {
      throw new Error(`API 请求失败: ${response.status}, ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    console.error("[LLM] 调用失败:", error);
    throw error;
  }
}

/**
 * 云函数主入口
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const { referenceText, studentText } = event;

  if (!referenceText || !studentText) {
    return { success: false, error: "缺少 referenceText 或 studentText 参数" };
  }

  try {
    console.log("[LLM] 开始评分...");
    console.log("[LLM] 标准答案长度:", referenceText.length);
    console.log("[LLM] 学生背诵长度:", studentText.length);

    // 调用 LLM 评分
    const result = await callSiliconFlowLLM(referenceText, studentText);
    console.log("[LLM] 评分完成:", JSON.stringify(result));

    return {
      success: true,
      data: {
        score: result.score,
        missing_points: result.missing_points || [],
        comment: result.comment || "",
        referenceText: referenceText,
        studentText: studentText,
        timestamp: Date.now(),
      },
    };
  } catch (error) {
    console.error("LLM 评分失败:", error);
    return { success: false, error: error.message };
  }
};
