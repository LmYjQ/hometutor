// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    const { prefix = '', limit = 20 } = event

    // 列出云存储中的文件
    const result = await cloud.getTempFileURL({
      fileList: []
    })

    // 由于 getTempFileURL 需要先有 fileID,我们需要用其他方式
    // 这里使用云存储的 list API (如果有的话)
    // 实际上微信云开发没有直接的 list API,需要记录在数据库中

    // 查询数据库中记录的文件
    const res = await db.collection('audio_files')
      .orderBy('uploadTime', 'desc')
      .limit(limit)
      .get()

    return {
      success: true,
      files: res.data
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    }
  }
}
