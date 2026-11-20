/**
 * 照片文件管理
 * 说明：wx.chooseMedia 返回的临时路径在小程序重启后会失效，
 * 必须调用 saveFile 落到本地文件系统，storage 中只保存返回的持久路径
 */

/** 将临时文件保存到本地文件系统，resolve 持久路径 */
function savePhoto(tempFilePath) {
  return new Promise((resolve, reject) => {
    if (!tempFilePath) {
      reject(new Error('缺少临时文件路径'));
      return;
    }
    wx.getFileSystemManager().saveFile({
      tempFilePath,
      success: (res) => resolve(res.savedFilePath),
      fail: (err) => reject(err)
    });
  });
}

/** 删除照片，文件不存在视为已清理，永不 reject */
function removePhoto(filePath) {
  return new Promise((resolve) => {
    if (!filePath) {
      resolve(false);
      return;
    }
    wx.getFileSystemManager().unlink({
      filePath,
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}

module.exports = {
  savePhoto,
  removePhoto
};
