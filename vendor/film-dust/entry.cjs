// 入口：只暴露除尘引擎的两个函数。引擎来自 magholmes/film-dust（MIT），见同目录 LICENSE.txt / NOTICES.txt。
module.exports = { cleanScan: require('./engine/pipeline').cleanScan, heal: require('./engine/heal').heal };
