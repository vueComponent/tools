'use strict';

const convert = require('koa-convert');
const serve = require('koa-static');
const path = require('path');
const webpackMiddleware = require('webpack-dev-middleware-for-koa');
const Koa = require('koa');
const serveIndex = require('koa-serve-index');
const koaBody = require('koa-body');
const Router = require('koa-router');
const webpack = require('webpack');
const chalk = require('chalk');
const fs = require('fs');
const resolveCwd = require('../resolveCwd');
const logger = require('koa-logger');
const getWebpackConfig = require('../getWebpackConfig');

require('xtpl').config({
  XTemplate: require('xtemplate'),
});

const cwd = process.cwd();
const pkg = require(resolveCwd('package.json'));

module.exports = function(app) {
  const router = new Router();
  app = app || new Koa();
  app = require('xtpl/lib/koa2')(app, {
    views: path.join(__dirname, '../../views'),
  });
  const root = cwd;
  if (pkg.config.accesslog) {
    app.use(logger());
    console.log('AccessLog Enable');
  }
  app.use(require('koa-favicon')(path.join(__dirname, '../../public/favicon.ico')));
  // parse application/x-www-form-urlencoded
  app.use(
    koaBody({
      formidable: { uploadDir: path.join(cwd, 'tmp') },
      multipart: true,
    })
  );

  app.use(router.routes()).use(router.allowedMethods());

  // app.use(router(app));
  app.use(require('./js2html'));
  let webpackConfig = getWebpackConfig({
    common: false,
    inlineSourceMap: true,
  });
  webpackConfig.plugins.push(
    new webpack.ProgressPlugin((percentage, msg) => {
      const stream = process.stderr;
      if (stream.isTTY && percentage < 0.71) {
        stream.cursorTo(0);
        stream.write(chalk.magenta(msg));
        stream.clearLine(1);
      } else if (percentage === 1) {
        console.log(chalk.green('\nwebpack: bundle build is now finished.'));
      }
    })
  );
  const publicPath = '/';
  if (fs.existsSync(path.join(cwd, 'webpack.config.js'))) {
    webpackConfig = require(path.join(cwd, 'webpack.config.js'))(webpackConfig);
  }

  const compiler = webpack(webpackConfig);
  compiler.hooks.done.tap('DonePlugin', stats => {
    if (stats.hasErrors()) {
      console.log(
        stats.toString({
          colors: true,
        })
      );
    }
  });

  const instance = webpackMiddleware(compiler, {
    publicPath,
    hot: true,
    https: false,
    quiet: true,
    logLevel: 'error',
    headers: {
      'Cache-control': 'no-cache',
    },
  });
  // instance.waitUntilValid(() => {
  //   console.log('Package is in a valid state');
  // });

  app.use(instance);
  app.use(
    convert(
      serveIndex(root, {
        hidden: true,
        view: 'details',
        icons: true,
        filter: filename => {
          return (
            filename.indexOf('.') !== 0 &&
            filename.indexOf('.js') < 0 &&
            filename.indexOf('.jsx') < 0 &&
            filename.indexOf('.ts') < 0 &&
            filename.indexOf('.tsx') < 0 &&
            filename.indexOf('.less') < 0 &&
            filename.indexOf('.css') < 0 &&
            filename.indexOf('.scss') < 0
          );
        },
      })
    )
  );
  app.use(
    serve(root, {
      hidden: true,
    })
  );
  return app;
};
