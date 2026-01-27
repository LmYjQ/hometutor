// pages/recitation/index.js
const app = getApp();

Page({
  data: {
    assignmentId: '',
    assignment: {
      class_name: '',
      question_title: '',
      reference_text: '',
      deadline: ''
    },
    cameraPosition: 'back',
    isRecording: false,
    recordingTimer: null,
    recordTime: 0,
    videoPath: '',
    videoSize: 0,
    uploading: false,
    analyzing: false,
    progress: 0,
    progressText: '准备中...',
    historySubmissions: []
  },

  onLoad(options) {
    if (options.assignmentId) {
      this.setData({ assignmentId: options.assignmentId });
      this.loadAssignment();
      this.loadHistory();
    }
  },

  onUnload() {
    this.stopRecording();
  },

  // 加载作业详情
  loadAssignment() {
    wx.cloud.callFunction({
      name: 'getStudentTodoList',
      data: {},
      success: (res) => {
        if (res.result.success) {
          const assignment = res.result.data.assignments.find(a => a._id === this.data.assignmentId);
          if (assignment) {
            this.setData({
              assignment: {
                class_name: assignment.class_name,
                question_title: assignment.question_title,
                reference_text: assignment.reference_text,
                deadline: assignment.deadline,
                deadlineText: assignment.deadlineText
              }
            });
          }
        }
      }
    });
  },

  // 加载历史提交记录
  loadHistory() {
    wx.cloud.callFunction({
      name: 'getStudentSubmissions',
      data: { assignmentId: this.data.assignmentId },
      success: (res) => {
        if (res.result.success) {
          this.setData({ historySubmissions: res.result.data });
        }
      }
    });
  },

  onReady() {
    // 页面 Ready 时创建 camera context
    console.log('[Recitation] onReady，创建 CameraContext');
    this.setData({ recordingCtx: wx.createCameraContext() });
  },

  // 切换录制状态
  toggleRecord() {
    console.log('[Recitation] toggleRecord, isRecording:', this.data.isRecording);
    if (this.data.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  },

  // 开始录制
  startRecording() {
    const ctx = this.data.recordingCtx;
    console.log('[Recitation] startRecording, ctx:', !!ctx);

    ctx.startRecord({
      success: () => {
        console.log('[Recitation] 录制已开始');
        this.setData({ isRecording: true });
        this.startTimer();
      },
      fail: (err) => {
        console.error('[Recitation] 开始录制失败:', err);
        wx.showToast({ title: '无法开始录制', icon: 'none' });
      }
    });
  },

  // 停止录制
  stopRecording() {
    console.log('[Recitation] stopRecording 被调用');
    const ctx = this.data.recordingCtx;

    ctx.stopRecord({
      success: (res) => {
        console.log('[Recitation] 录制停止成功, tempVideoPath:', res.tempVideoPath);
        this.handleVideoResult(res.tempVideoPath, res.tempThumbPath);
      },
      fail: (err) => {
        console.error('[Recitation] 停止录制失败:', err);
      }
    });

    this.stopTimer();
    this.setData({ isRecording: false });
  },

  // 处理录制结果
  handleVideoResult(videoPath, thumbPath) {
    console.log('[Recitation] handleVideoResult, path:', videoPath);
    wx.getFileInfo({
      filePath: videoPath,
      success: (res) => {
        const sizeMB = (res.size / 1024 / 1024).toFixed(2);
        console.log(`[Recitation] 视频录制成功: ${sizeMB} MB`);

        this.setData({
          videoPath: videoPath,
          videoSize: res.size,
          fileSizeText: `${sizeMB} MB`
        });
      },
      fail: (err) => {
        console.error('[Recitation] getFileInfo 失败:', err);
        this.setData({ videoPath: videoPath });
      }
    });
  },

  // 计时器
  startTimer() {
    this.setData({ recordTime: 0 });
    this.data.recordingTimer = setInterval(() => {
      if (this.data.recordTime >= 180) { // 最多3分钟
        this.stopRecording();
        return;
      }
      this.setData({ recordTime: this.data.recordTime + 1 });
    }, 1000);
  },

  stopTimer() {
    if (this.data.recordingTimer) {
      clearInterval(this.data.recordingTimer);
      this.data.recordingTimer = null;
    }
  },

  // 切换摄像头
  switchCamera() {
    this.setData({
      cameraPosition: this.data.cameraPosition === 'back' ? 'front' : 'back'
    });
  },

  // 重新录制
  reRecord() {
    this.setData({
      videoPath: '',
      videoSize: 0,
      fileSizeText: '',
      progress: 0,
      progressText: ''
    });
  },

  // 从相册选择视频
  chooseFromAlbum() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        const size = res.tempFiles[0].size;
        const sizeMB = (size / 1024 / 1024).toFixed(2);

        // 检查大小限制 (云函数限制100MB)
        if (size > 100 * 1024 * 1024) {
          wx.showToast({ title: '视频不能超过100MB', icon: 'none' });
          return;
        }

        this.setData({
          videoPath: tempFilePath,
          videoSize: size,
          fileSizeText: `${sizeMB} MB`
        });
      }
    });
  },

  // 提交背诵
  async submitRecitation() {
    if (!this.data.videoPath) {
      wx.showToast({ title: '请先录制或选择视频', icon: 'none' });
      return;
    }

    this.setData({ uploading: true, progress: 10, progressText: '上传视频中...' });

    try {
      // 1. 上传视频到云存储
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `recitations/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`,
        filePath: this.data.videoPath,
        env: app.globalData.env
      });

      console.log('视频上传成功:', uploadRes.fileID);
      this.setData({ progress: 40, progressText: '视频上传完成，AI分析中...' });

      // 2. 调用AI评分云函数
      this.setData({ uploading: false, analyzing: true });

      wx.cloud.callFunction({
        name: 'submitRecitation',
        data: {
          assignmentId: this.data.assignmentId,
          fileID: uploadRes.fileID
        },
        success: (res) => {
          if (res.result.success) {
            this.setData({ progress: 100, progressText: '评分完成！' });
            wx.showToast({ title: '提交成功', icon: 'success' });

            // 跳转到结果页面
            setTimeout(() => {
              wx.navigateTo({
                url: `/pages/submissionResult/index?submissionId=${res.result.data.submissionId}`
              });
            }, 1500);
          } else {
            wx.showToast({ title: res.result.error || '评分失败', icon: 'none' });
            this.setData({ analyzing: false });
          }
        },
        fail: (err) => {
          console.error('AI评分失败:', err);
          wx.showToast({ title: '评分失败，请重试', icon: 'none' });
          this.setData({ analyzing: false });
        }
      });
    } catch (err) {
      console.error('上传失败:', err);
      wx.showToast({ title: '上传失败，请重试', icon: 'none' });
      this.setData({ uploading: false });
    }
  },

  // 查看历史结果
  viewResult(e) {
    const submissionId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/submissionResult/index?submissionId=${submissionId}`
    });
  },

  onCameraError(e) {
    console.error('相机错误:', e.detail);
    wx.showToast({ title: '相机启动失败', icon: 'none' });
  }
});
