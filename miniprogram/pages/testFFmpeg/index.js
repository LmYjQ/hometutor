Page({
  data: {
    tab: 1,  // 默认显示前端 MediaContainer 方案
    loading: false,
    audioFileId: null,
    videoPath: null,
    transcription: null,
    evaluation: null,  // 评分结果
    // 预设的标准答案 (参考 run.py:147-148)
    referenceText: "1、纬度较高，气温较低，热量只能一年一熟。2、在春秋季节受寒潮影响，容易发生低温冻害"
  },

  onLoad() {
    console.log('页面加载完成');
  },

  // 选择视频并提取音频
  startProcess() {
    const self = this;

    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        const size = (res.tempFiles[0].size / 1024 / 1024).toFixed(2);
        self.setData({
          videoPath: tempFilePath,
          audioFileId: null
        });
        console.log(`从相册选择了视频 (${size} MB)`);

        self.extractAudio(tempFilePath);
      }
    });
  },

  // 提取音频并上传云存储
  extractAudio(videoPath) {
    this.setData({ loading: true });
    console.log('开始提取音频...');

    // 检查基础库版本
    const sysInfo = wx.getSystemInfoSync();
    const sdkVersion = sysInfo.SDKVersion;
    const [major, minor] = sdkVersion.split('.').map(Number);
    if (major < 2 || (major === 2 && minor < 9)) {
      console.error('基础库版本过低，需要 >= 2.9.0');
      wx.showToast({ title: '请更新基础库', icon: 'none' });
      this.setData({ loading: false });
      return;
    }

    // 检查 API 是否存在
    if (typeof wx.createMediaContainer !== 'function') {
      console.error('createMediaContainer API 不可用');
      wx.showToast({ title: 'API不可用', icon: 'none' });
      this.setData({ loading: false });
      return;
    }

    const mc = wx.createMediaContainer();
    console.log('MediaContainer 创建成功');

    mc.extractDataSource({
      source: videoPath,
      success: (extractRes) => {
        console.log('extractDataSource 成功');

        const tracks = extractRes.tracks;
        if (!tracks || !Array.isArray(tracks)) {
          console.error('轨道数据格式不正确', extractRes);
          this.setData({ loading: false });
          mc.destroy();
          return;
        }

        console.log(`分离出 ${tracks.length} 个轨道`);

        // 过滤出音频轨道
        const audioTracks = tracks.filter(track => track.kind === 'audio');
        if (audioTracks.length === 0) {
          console.error('视频中没有音频轨道');
          wx.showToast({ title: '无音频轨道', icon: 'none' });
          this.setData({ loading: false });
          mc.destroy();
          return;
        }

        console.log(`找到 ${audioTracks.length} 个音频轨道`);

        // 添加音频轨道
        audioTracks.forEach(track => {
          mc.addTrack(track);
        });

        // 导出音频
        mc.export({
          format: 'mp3',
          success: (exportRes) => {
            console.log('音频导出成功');

            // 上传到云存储
            wx.cloud.uploadFile({
              cloudPath: `audio_${Date.now()}.mp3`,
              filePath: exportRes.tempFilePath,
              env: 'hometutor-1gw067pt8eeae1ac',
              success: (uploadRes) => {
                console.log('音频上传成功:', uploadRes.fileID);
                this.setData({ audioFileId: uploadRes.fileID, loading: false });
                wx.showToast({ title: '转换成功', icon: 'success' });
                mc.destroy();
              },
              fail: (err) => {
                console.error('上传失败:', err);
                this.setData({ loading: false });
                mc.destroy();
              }
            });
          },
          fail: (err) => {
            console.error('导出失败:', err);
            this.setData({ loading: false });
            mc.destroy();
          }
        });
      },
      fail: (err) => {
        console.error('extractDataSource 失败:', err);
        this.setData({ loading: false });
        mc.destroy();
      }
    });
  },

  // 播放音频预览
  playAudio() {
    if (!this.data.audioFileId) {
      wx.showToast({ title: '暂无音频', icon: 'none' });
      return;
    }

    wx.cloud.getTempFileURL({
      fileList: [this.data.audioFileId],
      success: (res) => {
        if (res.fileList[0].tempFileURL) {
          const audioContext = wx.createInnerAudioContext();
          audioContext.src = res.fileList[0].tempFileURL;
          audioContext.play();
          console.log('开始播放音频');
        }
      },
      fail: (err) => {
        console.error('获取播放链接失败:', err);
      }
    });
  },

  // 下载音频文件到本地
  downloadAudio() {
    const self = this;
    if (!this.data.audioFileId) {
      wx.showToast({ title: '暂无音频', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '下载中...', mask: true });

    wx.cloud.getTempFileURL({
      fileList: [this.data.audioFileId],
      success: (res) => {
        if (res.fileList[0].tempFileURL) {
          const tempUrl = res.fileList[0].tempFileURL;
          console.log('开始下载音频:', tempUrl);

          wx.downloadFile({
            url: tempUrl,
            success: (downloadRes) => {
              console.log('下载成功:', downloadRes.tempFilePath);

              // 保存到本地
              wx.saveFile({
                tempFilePath: downloadRes.tempFilePath,
                success: (saveRes) => {
                  wx.hideLoading();
                  wx.showToast({
                    title: '已保存到本地',
                    icon: 'success',
                    duration: 2000
                  });
                  console.log('保存成功:', saveRes.savedFilePath);
                },
                fail: (err) => {
                  wx.hideLoading();
                  wx.showToast({ title: '保存失败', icon: 'none' });
                  console.error('保存失败:', err);
                }
              });
            },
            fail: (err) => {
              wx.hideLoading();
              wx.showToast({ title: '下载失败', icon: 'none' });
              console.error('下载失败:', err);
            }
          });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        wx.showToast({ title: '获取链接失败', icon: 'none' });
        console.error('获取播放链接失败:', err);
      }
    });
  },

  // 语音识别
  recognizeSpeech() {
    const self = this;
    if (!this.data.audioFileId) {
      wx.showToast({ title: '请先转换音频', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '识别中...', mask: true });

    wx.cloud.callFunction({
      name: 'speechRecognition',
      data: { fileID: this.data.audioFileId },
      success: (res) => {
        console.log('语音识别结果:', res.result);
        if (res.result.success) {
          self.setData({ transcription: res.result.data.text });
          wx.showToast({ title: '识别成功', icon: 'success' });
        } else {
          wx.showToast({ title: res.result.error || '识别失败', icon: 'none' });
        }
      },
      fail: (err) => {
        console.error('调用云函数失败:', err);
        wx.showToast({ title: '识别失败', icon: 'none' });
      },
      complete: () => {
        self.setData({ loading: false });
        wx.hideLoading();
      }
    });
  },

  // LLM 评分 (参考 run.py:83-119 step_3_evaluate)
  evaluateRecitation() {
    const self = this;
    if (!this.data.transcription) {
      wx.showToast({ title: '请先进行语音识别', icon: 'none' });
      return;
    }

    if (!this.data.referenceText) {
      wx.showToast({ title: '请设置标准答案', icon: 'none' });
      return;
    }

    this.setData({ loading: true, evaluation: null });
    wx.showLoading({ title: '评分中...', mask: true });

    wx.cloud.callFunction({
      name: 'llmScoring',
      data: {
        referenceText: this.data.referenceText,
        studentText: this.data.transcription
      },
      success: (res) => {
        console.log('LLM 评分结果:', res.result);
        if (res.result.success) {
          self.setData({ evaluation: res.result.data });
          wx.showToast({ title: '评分完成', icon: 'success' });
        } else {
          wx.showToast({ title: res.result.error || '评分失败', icon: 'none' });
        }
      },
      fail: (err) => {
        console.error('调用云函数失败:', err);
        wx.showToast({ title: '评分失败', icon: 'none' });
      },
      complete: () => {
        self.setData({ loading: false });
        wx.hideLoading();
      }
    });
  },

  // 清空
  clearVideo() {
    this.setData({
      videoPath: null,
      audioFileId: null,
      transcription: null,
      evaluation: null
    });
    console.log('已清空');
  },

  // Tab 切换
  switchTab(e) {
    const tab = parseInt(e.currentTarget.dataset.tab);
    this.setData({ tab });
  },

  // 测试 ffmpeg
  testFFmpeg() {
    wx.showToast({ title: '功能开发中', icon: 'none' });
  },

  // 查看数据库文件
  queryDatabaseFiles() {
    wx.showToast({ title: '功能开发中', icon: 'none' });
  },

  // 清空日志
  clearLogs() {
    this.setData({ logs: [] });
  }
});
