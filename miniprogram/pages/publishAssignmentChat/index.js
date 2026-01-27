// pages/publishAssignmentChat/index.js
const fs = wx.getFileSystemManager();

Page({
  data: {
    classId: '',
    className: '',
    messages: [],
    inputValue: '',
    showFilePicker: false,
    uploading: false,
    scrollIntoView: ''
  },

  onLoad(options) {
    if (options.classId) {
      this.setData({
        classId: options.classId,
        className: options.className || ''
      });
    }
    this.initMessages();
  },

  initMessages() {
    // 初始化欢迎消息
    this.setData({
      messages: [
        {
          id: 1,
          type: 'system',
          content: '欢迎使用作业发布助手！请上传CSV或Excel文件，或从剪贴板复制数据。'
        },
        {
          id: 2,
          type: 'system',
          content: '文件格式要求：第一列为作业说明，第二列为参考答案，第三列为截止日期，格式2026-01-26\n推荐使用Excel格式，可避免换行问题。'
        },
        {
          id: 3,
          type: 'system',
          content: '不需要写表头，第一行就直接写内容。'
        }
      ]
    });
  },

  onChooseImage() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv', 'xlsx', 'xls'],
      success: (res) => {
        const tempFile = res.tempFiles[0];
        const fileName = tempFile.name.toLowerCase();
        if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
          this.readExcelFile(tempFile);
        } else {
          this.readCSVFile(tempFile);
        }
      },
      fail: (err) => {
        console.error('选择文件失败:', err);
        wx.showToast({
          title: '请选择CSV或Excel文件',
          icon: 'none'
        });
      }
    });
  },

  // 从剪贴板粘贴数据
  onPasteFromClipboard() {
    const self = this;
    wx.getClipboardData({
      success: (res) => {
        const content = res.data;
        if (!content.trim()) {
          wx.showToast({
            title: '剪贴板为空',
            icon: 'none'
          });
          return;
        }

        // 添加用户消息
        self.addMessage({
          type: 'user',
          content: '从剪贴板粘贴数据'
        });

        // 显示预览（和CSV文件一样的处理逻辑）
        self.previewCSVContent(content, '剪贴板内容');
      },
      fail: (err) => {
        console.error('获取剪贴板内容失败:', err);
        wx.showToast({
          title: '获取剪贴板失败',
          icon: 'none'
        });
      }
    });
  },

  readCSVFile(file) {
    const self = this;

    // 添加用户消息
    this.addMessage({
      type: 'user',
      content: `已选择文件: ${file.name}`,
      attachment: file.name
    });

    wx.showLoading({ title: '读取文件中...' });

    fs.readFile({
      filePath: file.path,
      encoding: 'utf8',
      success: (data) => {
        wx.hideLoading();
        self.previewCSVContent(data.data, file.name);
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('读取文件失败:', err);
        self.addMessage({
          type: 'assistant',
          content: '读取文件失败，请重试'
        });
      }
    });
  },

  // 读取Excel文件
  readExcelFile(file) {
    const self = this;

    // 添加用户消息
    this.addMessage({
      type: 'user',
      content: `已选择文件: ${file.name}`,
      attachment: file.name
    });

    wx.showLoading({ title: '读取文件中...' });

    // 读取文件为ArrayBuffer，然后转base64
    fs.readFile({
      filePath: file.path,
      encoding: '', // 不指定编码，获取原始二进制数据
      success: (data) => {
        wx.hideLoading();
        // 将ArrayBuffer转为base64
        const base64 = wx.arrayBufferToBase64(data.data);
        self.previewExcelContent(base64, file.name);
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('读取文件失败:', err);
        self.addMessage({
          type: 'assistant',
          content: '读取文件失败，请重试'
        });
      }
    });
  },

  // 预览Excel内容
  previewExcelContent(base64Content, fileName) {
    // 暂存base64内容用于上传
    this.tempExcelBase64 = base64Content;

    // 显示提示信息
    this.addMessage({
      type: 'assistant',
      content: `已读取Excel文件 ${fileName}。\n点击下方按钮发布作业，数据将在云端解析。\n\n提示：Excel格式与CSV相同，第一列为作业说明，第二列为参考答案，第三列为截止日期。`,
      previewData: {
        isExcel: true,
        fileName: fileName
      }
    });
  },

  previewCSVContent(content, fileName) {
    // 显示文件内容预览
    const lines = content.trim().split('\n');
    const preview = lines.slice(0, 5).map((line, i) => `行${i + 1}: ${line}`).join('\n');
    const more = lines.length > 5 ? `\n... 共 ${lines.length} 行` : '';

    this.addMessage({
      type: 'assistant',
      content: `已读取文件 ${fileName}，共 ${lines.length} 行作业数据。\n\n预览：\n${preview}${more}\n\n确认发布这些作业吗？`,
      previewData: {
        rowCount: lines.length,
        content: content
      }
    });
  },

  confirmPublish() {
    const lastMsg = this.data.messages[this.data.messages.length - 1];
    if (!lastMsg || !lastMsg.previewData) {
      wx.showToast({
        title: '请先上传文件',
        icon: 'none'
      });
      return;
    }

    // 判断是Excel还是CSV
    if (lastMsg.previewData.isExcel) {
      this.publishExcelAssignments();
    } else {
      this.publishAssignments(lastMsg.previewData.content);
    }
  },

  publishAssignments(csvContent) {
    this.setData({ uploading: true });

    wx.showLoading({ title: '发布中...' });

    wx.cloud.callFunction({
      name: 'publishAssignment',
      data: {
        classId: this.data.classId,
        className: this.data.className,
        fileContent: csvContent,
        fileType: 'csv'
      },
      success: (res) => {
        if (res.result.success) {
          const { count } = res.result.data;
          this.addMessage({
            type: 'assistant',
            content: `✅ 成功发布 ${count} 个作业！\n\n作业已添加到班级中，学生可以看到并提交背诵视频。`
          });
        } else {
          this.addMessage({
            type: 'assistant',
            content: `❌ 发布失败：${res.result.error}`
          });
        }
      },
      fail: (err) => {
        console.error('发布作业失败:', err);
        this.addMessage({
          type: 'assistant',
          content: '❌ 网络错误，请重试'
        });
      },
      complete: () => {
        this.setData({ uploading: false });
        wx.hideLoading();
      }
    });
  },

  // 发布Excel文件中的作业
  publishExcelAssignments() {
    if (!this.tempExcelBase64) {
      wx.showToast({
        title: '请重新上传文件',
        icon: 'none'
      });
      return;
    }

    this.setData({ uploading: true });

    wx.showLoading({ title: '发布中...' });

    wx.cloud.callFunction({
      name: 'publishAssignment',
      data: {
        classId: this.data.classId,
        className: this.data.className,
        fileContent: this.tempExcelBase64,
        fileType: 'excel'
      },
      success: (res) => {
        if (res.result.success) {
          const { count } = res.result.data;
          this.addMessage({
            type: 'assistant',
            content: `✅ 成功发布 ${count} 个作业！\n\n作业已添加到班级中，学生可以看到并提交背诵视频。`
          });
        } else {
          this.addMessage({
            type: 'assistant',
            content: `❌ 发布失败：${res.result.error}`
          });
        }
      },
      fail: (err) => {
        console.error('发布作业失败:', err);
        this.addMessage({
          type: 'assistant',
          content: '❌ 网络错误，请重试'
        });
      },
      complete: () => {
        this.setData({ uploading: false });
        wx.hideLoading();
        // 清空临时数据
        this.tempExcelBase64 = null;
      }
    });
  },

  addMessage(msg) {
    const messages = [...this.data.messages, {
      id: Date.now(),
      ...msg
    }];
    this.setData({
      messages,
      scrollIntoView: `msg-${Date.now()}`
    });

    // 滚动到底部
    this.scrollToBottom();
  },

  scrollToBottom() {
    wx.createSelectorQuery()
      .select('#chat-container')
      .boundingClientRect((rect) => {
        if (rect) {
          wx.pageScrollTo({
            scrollTop: rect.height,
            duration: 300
          });
        }
      })
      .exec();
  },

  onInput(e) {
    this.setData({
      inputValue: e.detail.value
    });
  },

  sendMessage() {
    if (!this.data.inputValue.trim()) return;

    this.addMessage({
      type: 'user',
      content: this.data.inputValue
    });

    this.setData({ inputValue: '' });
  },

  onShareAppMessage() {
    return {
      title: '作业发布助手',
      path: '/pages/publishAssignmentChat/index'
    };
  }
});
