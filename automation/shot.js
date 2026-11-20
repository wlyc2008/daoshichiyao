const path = require('path');
const automator = require('miniprogram-automator');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 连接已开启的自动化端口并截取当前页面
 * 用法: node shot.js [输出路径] [页面路由]
 * 前置: 在终端执行 cli auto --project <项目路径> --auto-port 9420
 */
(async () => {
  const wsEndpoint = process.env.AUTO_WS || 'ws://127.0.0.1:9420';
  const outPath = process.argv[2] || path.join(process.env.TEMP || '.', 'wx-shot.png');
  const route = process.argv[3] || '';

  const miniProgram = await automator.connect({ wsEndpoint });

  // 自动化端口刚建立时模拟器可能还在加载，轮询等待页面就绪
  let page = null;
  for (let i = 0; i < 15; i++) {
    try {
      page = await miniProgram.currentPage();
      if (page) break;
    } catch (err) {
      // 页面元信息尚未就绪，继续等待
    }
    await sleep(800);
  }

  if (!page) {
    throw new Error('等待页面就绪超时，请确认模拟器已编译完成');
  }

  // 需要指定页面时先跳转，再等待渲染
  if (route) {
    await miniProgram.reLaunch(route);
    await sleep(1200);
    page = await miniProgram.currentPage();
  }

  console.log('当前页面:', page.path);
  await miniProgram.screenshot({ path: outPath });
  console.log('截图已保存:', outPath);

  await miniProgram.disconnect();
})().catch((err) => {
  console.error('自动化执行失败:', err.message);
  process.exit(1);
});
