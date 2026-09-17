// pages/recitation/index.js
const app = getApp();
const { request, uploadToCloud } = require('../../utils/request');

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
    showCamera: false,         // 默认不显示摄像头，用户点「录制」才打开
    videoPath: '',
    videoSize: 0,
    uploading: false,
    analyzing: false,
    progress: 0,
    progressText: '准备中...',
    // 分阶段步骤：抽音频 → 上传 → 语音识别 → AI评分
    steps: [
      { key: 'extract', label: '提取音频', status: 'pending' },
      { key: 'upload',   label: '上传文件', status: 'pending' },
      { key: 'asr',      label: '语音识别', status: 'pending' },
      { key: 'llm',      label: 'AI 评分',  status: 'pending' }
    ],
    historySubmissions: [],
    maxSubmissions: 0,
    remainingSubmissions: -1,
    // 已完成状态：最近一次成功提交的 submissionId（用于「返回查看已完成」）
    lastSubmissionId: '',
    lastSubmittedAt: 0
  },

  onLoad(options) {
    if (options.assignmentId) {
      this.setData({ assignmentId: options.assignmentId });
      this.loadAssignment();
      this.loadHistory();
    }
  },

  onUnload() {
    // 标记页面已卸载，防止 AI 评分云函数回调时调用 setData 触发警告
    this._destroyed = true;
    this.stopRecording();
  },

  onShow() {
    // 场景：submitRecitation 成功后 navigateTo 到结果页，再点左上角返回 → analyzing: true 残留
    // 此时应该展示「✅ 已完成」而不是「AI评分中」
    if (this.data.analyzing || this.data.uploading) {
      console.log('[Recitation] onShow 清掉残留 loading，恢复到「已完成」');
      this.setData({
        uploading: false,
        analyzing: false,
        progress: 0,
        progressText: ''
      });
    }
    // 回来时刷新历史记录（结果页可能写了新提交）
    if (this.data.assignmentId) {
      this.loadHistory();
    }
  },

  // 加载作业详情
  async loadAssignment() {
    try {
      const res = await request('/api/student/todo-list', { method: 'GET' });
      if (res && res.success && res.data) {
        const all = (res.data.assignments || []);
        const found = all.find((a) => (a.id || a._id) === this.data.assignmentId);
        if (found) {
          this.setData({
            assignment: {
              class_name: found.className || found.class_name,
              question_title: found.questionTitle || found.question_title,
              reference_text: found.referenceText || found.reference_text,
              deadline: found.deadline,
              deadlineText: found.deadlineText,
            },
          });
        }
      }
    } catch (e) {
      console.error('[loadAssignment] 失败:', e);
    }
  },

  // 加载历史提交记录
  async loadHistory() {
    try {
      const res = await request('/api/student/submissions', {
        method: 'GET',
        data: { assignmentId: this.data.assignmentId },
      });
      if (res && res.success && res.data) {
        // 老格式 data[] / 新格式 data.submissions[]
        const subs = Array.isArray(res.data) ? res.data : (res.data.submissions || []);
        // 兼容老字段
        const normalized = subs.map((s) => ({
          ...s,
          _id: s._id || s.id,
          audio_text: s.audio_text || s.audioText,
          created_at: s.created_at || s.createdAt,
        }));
        this.setData({ historySubmissions: normalized });
        if (typeof res.data.remainingAttempts === 'number') {
          this.setData({ remainingSubmissions: res.data.remainingAttempts });
        }
        this.updateRemainingSubmissions();
      }
    } catch (e) {
      console.error('[loadHistory] 失败:', e);
    }
  },

  // 更新剩余提交次数
  updateRemainingSubmissions() {
    const maxSubs = this.data.maxSubmissions;
    if (maxSubs > 0) {
      const gradedCount = this.data.historySubmissions.filter(
        s => s.status === 'graded'
      ).length;
      this.setData({
        remainingSubmissions: Math.max(0, maxSubs - gradedCount)
      });
    }
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
      progressText: '',
      showCamera: false   // 关闭摄像头，回到入口按钮页
    });
  },

  // 从相册选择视频
  // 用 wx.chooseMedia 而不是 wx.chooseVideo：
  //   - chooseMedia 对视频文件做格式校验，能过滤掉不支持的格式（避免上传后才发现）
  //   - chooseMedia 返回 tempFiles 数组（多选场景更通用）
  // 配合防御性空数组判断，崩溃不会发生
  chooseFromAlbum() {
    console.log('[chooseFromAlbum] 被点击，准备调 wx.chooseMedia');
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album'],
      success: (res) => {
        console.log('[chooseFromAlbum] success 回调:', JSON.stringify({
          tempFilesLen: res.tempFiles?.length,
          firstFile: res.tempFiles?.[0]
        }));
        // 防御性：tempFiles 是空数组时（用户取消），静默 return，不报错
        if (!res.tempFiles || res.tempFiles.length === 0) {
          console.warn('[chooseFromAlbum] tempFiles 为空（用户取消）');
          return;
        }
        const file = res.tempFiles[0];
        const tempFilePath = file.tempFilePath || file.path;
        if (!tempFilePath) {
          console.error('[chooseFromAlbum] 拿不到视频路径:', file);
          wx.showToast({ title: '视频选择失败', icon: 'none' });
          return;
        }
        console.log('[chooseFromAlbum] 准备 setData, tempFilePath:', tempFilePath, 'size:', file.size, 'duration:', file.duration);
        const size = file.size || 0;
        const sizeMB = (size / 1024 / 1024).toFixed(2);
        const duration = file.duration || 0;

        // 大小限制（云函数限制100MB）
        if (size > 100 * 1024 * 1024) {
          wx.showToast({ title: '视频不能超过100MB', icon: 'none' });
          return;
        }
        // 时长限制：超过 3 分钟的不要（ASR/LLM 处理时间会爆炸）
        if (duration > 180) {
          wx.showToast({ title: '视频时长超过3分钟，请精简', icon: 'none' });
          return;
        }

        this.setData({
          videoPath: tempFilePath,
          videoSize: size,
          fileSizeText: `${sizeMB} MB`
        });
        console.log('[chooseFromAlbum] setData 完成, videoPath:', this.data.videoPath);
      },
      fail: (err) => {
        console.error('[chooseFromAlbum] fail 回调:', err);
        // 用户主动取消时不弹错
        if (err.errMsg && err.errMsg.includes('cancel')) return;
        wx.showToast({ title: '选择视频失败', icon: 'none' });
      },
      complete: () => {
        console.log('[chooseFromAlbum] complete');
      }
    });
  },

  // 从聊天文件选（专门应对 mp4 在系统相册被 wx.chooseMedia 过滤掉的场景）
  // wx.chooseMessageFile 直接从微信聊天/收藏的文件面板选，不走相册过滤
  chooseFromChatFile() {
    console.log('[chooseFromChatFile] 被点击');
    wx.chooseMessageFile({
      count: 1,
      type: 'video',           // 限制为视频类型
      extension: ['mp4', 'mov', 'm4v', '3gp', 'avi'],
      success: (res) => {
        console.log('[chooseFromChatFile] success:', JSON.stringify({
          tempFilesLen: res.tempFiles?.length,
          firstFile: res.tempFiles?.[0]
        }));
        if (!res.tempFiles || res.tempFiles.length === 0) {
          return;
        }
        const file = res.tempFiles[0];
        const tempFilePath = file.path || file.tempFilePath;
        if (!tempFilePath) {
          console.error('[chooseFromChatFile] 拿不到路径:', file);
          wx.showToast({ title: '文件读取失败', icon: 'none' });
          return;
        }
        const size = file.size || 0;
        const sizeMB = (size / 1024 / 1024).toFixed(2);

        if (size > 100 * 1024 * 1024) {
          wx.showToast({ title: '视频不能超过100MB', icon: 'none' });
          return;
        }

        this.setData({
          videoPath: tempFilePath,
          videoSize: size,
          fileSizeText: `${sizeMB} MB`
        });
        console.log('[chooseFromChatFile] setData 完成');
      },
      fail: (err) => {
        console.error('[chooseFromChatFile] fail:', err);
        if (err.errMsg && err.errMsg.includes('cancel')) return;
        wx.showToast({ title: '选择失败', icon: 'none' });
      }
    });
  },

  // 用户点「录制视频」入口 → 打开摄像头
  openCameraToRecord() {
    this.setData({ showCamera: true });
  },

  // 提交背诵
  async submitRecitation() {
    if (!this.data.videoPath) {
      wx.showToast({ title: '请先录制或选择视频', icon: 'none' });
      return;
    }

    // 重置步骤状态
    this.resetSteps();

    this.setData({ uploading: true, progress: 5, progressText: '正在提取音频...' });
    this.setStep('extract', 'active');

    try {
      // 1. 优先尝试本地抽音频（m4a，几 KB~几十 KB），ASR 更快、计费更省
      //    失败/不支持时降级用原 mp4，体验不崩
      const extractStart = Date.now();
      const audioPath = await this.extractAudioFromVideo(this.data.videoPath).catch((e) => {
        console.warn('[Recitation] 本地抽音频失败，降级传 mp4:', e);
        return null;
      });
      const audioSizeBytes = audioPath ? await this.getFileSize(audioPath) : 0;
      console.log(`[Recitation] 抽音频${audioPath ? '成功' : '降级'}, 耗时 ${Date.now() - extractStart}ms, ${audioPath ? audioSizeBytes + ' bytes' : '用原视频'}`);

      this.setStep('extract', 'done');

      const uploadFilePath = audioPath || this.data.videoPath;
      const uploadExt = audioPath ? 'm4a' : 'mp4';
      const uploadContentType = audioPath ? 'audio/x-m4a' : 'video/mp4';

      // 2. 上传到云存储
      this.setStep('upload', 'active');
      this.setData({ progress: 20, progressText: '上传文件中...' });
      const uploadRes = await uploadToCloud({
        cloudPath: `recitations/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${uploadExt}`,
        filePath: uploadFilePath,
      });
      console.log('文件上传成功:', uploadRes.fileID, 'type:', uploadContentType);
      this.setStep('upload', 'done');

      // 3. 调后端（内部按顺序走 ASR → LLM）
      this.setStep('asr', 'active');
      this.setStep('llm', 'active');
      this.setData({ progress: 50, progressText: 'AI 评分中...' });
      this.setData({ uploading: false, analyzing: true });

      let result;
      try {
        result = await request('/api/submit-recitation', {
          method: 'POST',
          data: {
            assignmentId: this.data.assignmentId,
            fileID: uploadRes.fileID,
            contentType: uploadContentType,
          },
          timeout: 95000,  // 95 秒，比云函数超时(90s)留 5s 缓冲，避免两端同时到时
        });
      } catch (err) {
        console.error('AI评分失败:', err);
        if (this._destroyed) return;
        wx.showToast({ title: '评分超时或失败，请重试', icon: 'none' });
        this.setData({ analyzing: false });
        this.resetSteps();
        return;
      }

      if (result && result.success) {
        this.setStep('asr', 'done');
        this.setStep('llm', 'done');

        this.setData({
          analyzing: false,
          uploading: false,
          progress: 100,
          progressText: '评分完成！',
          lastSubmissionId: result.data.submissionId,
          lastSubmittedAt: Date.now(),
          videoPath: '',
          videoSize: 0,
          fileSizeText: '',
        });
        wx.showToast({ title: '提交成功', icon: 'success' });

        setTimeout(() => {
          wx.navigateTo({
            url: `/pages/submissionResult/index?submissionId=${result.data.submissionId}`,
          });
        }, 1500);
      } else {
        const errCode = (result && result.error) || '';
        if (errCode === 'MAX_SUBMISSIONS_EXCEEDED') {
          wx.showModal({
            title: '无法提交',
            content: errCode,
            showCancel: false,
          });
          this.setData({ analyzing: false, remainingSubmissions: 0 });
          this.resetSteps();
          return;
        }
        wx.showToast({ title: errCode || '评分失败', icon: 'none' });
        this.setData({ analyzing: false });
        this.resetSteps();
      }
    } catch (err) {
      console.error('上传失败:', err);
      wx.showToast({ title: '上传失败，请重试', icon: 'none' });
      this.setData({ uploading: false });
      this.resetSteps();
    }
  },

  // 把所有步骤重置为 pending
  resetSteps() {
    const steps = this.data.steps.map(s => ({ ...s, status: 'pending' }));
    this.setData({ steps });
  },

  // 更新单个步骤状态：status = 'pending' | 'active' | 'done'
  setStep(key, status) {
    const steps = this.data.steps.map(s => s.key === key ? { ...s, status } : s);
    this.setData({ steps });
  },

  // 用 MediaContainer 抽 mp4 的音频轨道 → m4a
  // 失败/不支持时 throw，由调用方降级用原视频
  extractAudioFromVideo(videoPath) {
    return new Promise((resolve, reject) => {
      if (!wx.createMediaContainer) {
        reject(new Error('当前微信版本不支持 MediaContainer'));
        return;
      }
      const container = wx.createMediaContainer();
      container.extractDataSource({
        source: videoPath,
        success: (res) => {
          console.log('[extractAudio] extractDataSource 完整返回:', JSON.stringify(res));
          // 打印每条 track 的所有 key + type 值，方便诊断字段名到底是 audio/video 还是别的
          const tracks = res.tracks || [];
          console.log(`[extractAudio] 共 ${tracks.length} 条 track`);
          tracks.forEach((t, idx) => {
            console.log(`[extractAudio] track[${idx}]:`, JSON.stringify(t), 'typeof type =', typeof t.type);
          });
          // 兼容几种可能的 type 写法
          const audioTrack = tracks.find(t =>
            t.type === 'audio' ||
            t.kind === 'audio' ||
            t.trackType === 'audio'
          );
          if (!audioTrack) {
            console.error('[extractAudio] 没找到 audio 轨道。可用 type 值:', JSON.stringify([...new Set(tracks.map(t => String(t.type)))])
            );
            reject(new Error('视频中找不到音频轨道'));
            return;
          }
          container.addTrack(audioTrack);
          container.export({
            success: (exp) => {
              console.log('[extractAudio] export success, tempFilePath:', exp.tempFilePath);
              container.destroy();
              resolve(exp.tempFilePath);
            },
            fail: (err) => {
              console.error('[extractAudio] export fail:', err);
              container.destroy();
              reject(err);
            }
          });
        },
        fail: (err) => {
          console.error('[extractAudio] extractDataSource fail:', err);
          container.destroy();
          reject(err);
        }
      });
    });
  },

  // 拿临时文件大小（异步 wx.getFileInfo 包装）
  getFileSize(filePath) {
    return new Promise((resolve) => {
      wx.getFileInfo({
        filePath,
        success: (res) => resolve(res.size || 0),
        fail: () => resolve(0)
      });
    });
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
