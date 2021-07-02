'use strict';

const gulp = require('gulp');
const path = require('path');
const through2 = require('through2');
const webpack = require('webpack');
const shelljs = require('shelljs');
const babel = require('gulp-babel');
const fs = require('fs-extra');
const argv = require('minimist')(process.argv.slice(2));
const postcss = require('gulp-postcss');
const chalk = require('chalk');
const ts = require('gulp-typescript');
const merge2 = require('merge2');
const glob = require('glob');
const assign = require('object-assign');
const minify = require('gulp-babel-minify');
const prettier = require('gulp-prettier');

const resolveCwd = require('./resolveCwd');
const getWebpackConfig = require('./getWebpackConfig');
const { runCmd, getNpmArgs } = require('./util');
const getBabelCommonConfig = require('./getBabelCommonConfig');
const tsConfig = require('./getTSCommonConfig')();
const { measureFileSizesBeforeBuild, printFileSizesAfterBuild } = require('./FileSizeReporter');
const replaceLib = require('./replaceLib');
const { printResult } = require('./gulpTasks/util');

const pkg = require(resolveCwd('package.json'));
const cwd = process.cwd();
const lessPath = new RegExp(`(["']${pkg.name})/assets/([^.'"]+).less`, 'g');
const tsDefaultReporter = ts.reporter.defaultReporter();
const src = argv.src || 'src';
const parallel =  pkg.config.parallel || ['es', 'js', 'css'];

// ============================== Clean ==============================
const cleanTasks = require('./gulpTasks/cleanTasks');

const { cleanCompile } = cleanTasks;

cleanTasks(gulp);

// ============================== MISC ===============================
gulp.task(
  'check-deps',
  gulp.series((done) => {
    if (argv['check-deps'] !== false) {
      require('./checkDep')(done);
    }
  })
);

function reportError() {
  console.log(chalk.bgRed('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'));
  console.log(chalk.bgRed('!! `npm publish` is forbidden for this package. !!'));
  console.log(chalk.bgRed('!! Use `npm run pub` instead.        !!'));
  console.log(chalk.bgRed('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'));
}

gulp.task(
  'guard',
  gulp.series((done) => {
    const npmArgs = getNpmArgs();
    if (npmArgs) {
      for (let arg = npmArgs.shift(); arg; arg = npmArgs.shift()) {
        if (/^pu(b(l(i(sh?)?)?)?)?$/.test(arg) && npmArgs.indexOf('--with-vc-tools') < 0) {
          reportError();
          done(1);
          return;
        }
      }
    }
    done();
  })
);

// ============================= Package =============================
gulp.task('css', () => {
  const less = require('gulp-less');
  return gulp
    .src('assets/*.less')
    .pipe(less())
    .pipe(postcss([require('./getAutoprefixer')()]))
    .pipe(gulp.dest('assets'));
});

function babelifyInternal(js, modules) {
  function replacer(match, m1, m2) {
    return `${m1}/assets/${m2}.css`;
  }

  const babelConfig = getBabelCommonConfig(modules);
  if (modules === false) {
    babelConfig.plugins.push(replaceLib);
  }

  let stream = js.pipe(babel(babelConfig));
  if (argv.compress) {
    stream = stream.pipe(minify());
  }
  return stream
    .pipe(
      through2.obj(function (file, encoding, next) {
        const contents = file.contents.toString(encoding).replace(lessPath, replacer);
        file.contents = Buffer.from(contents);
        this.push(file);
        next();
      })
    )
    .pipe(gulp.dest(modules !== false ? 'lib' : 'es'));
}

gulp.task(
  'genPrettierrc',
  gulp.series((done) => {
    const dir = resolveCwd('./');
    const prettierrc = path.join(__dirname, '../config/.prettierrc');
    const prettierrcContent = fs.readFileSync(prettierrc);
    fs.writeFileSync(path.join(dir, './.prettierrc'), prettierrcContent);
    done();
  })
);

gulp.task(
  'prettier',
  gulp.series(() => {
    let fileList = (argv._ || []).slice(1);
    if (!fileList.length) {
      fileList = [
        './src/**/*.{js,jsx}',
        './tests/**/*.{js,jsx}',
        './code/**/*.{js,jsx}',
        './storybook/**/*.{js,jsx}',
        './examples/**/*.{js,jsx}',
      ];
    } else {
      console.log(chalk.blue(`Prettier:\n${fileList.join('\n')}`));
    }

    const prettierrc = path.join(__dirname, '../config/.prettierrc');
    const prettierrcContent = fs.readFileSync(prettierrc, 'utf8');
    return gulp
      .src(fileList)
      .pipe(
        prettier(JSON.parse(prettierrcContent), {
          reporter: 'error',
        })
      )
      .pipe(gulp.dest((file) => file.base));
  })
);

gulp.task(
  'genEslint',
  gulp.series((done) => {
    const dir = resolveCwd('./');
    const eslintConfig = path.join(__dirname, '../config/eslintrc.js');
    const eslintContent = fs.readFileSync(eslintConfig);
    fs.writeFileSync(path.join(dir, './.eslintrc.js'), eslintContent);
    done();
  })
);

gulp.task('gen-lint-config', gulp.series('genPrettierrc', 'genEslint'));

gulp.task('js', () => {
  console.log('[Parallel] compile js...');
  return babelify();
});

gulp.task('es', () => {
  console.log('[Parallel] compile es...');
  return babelify(false);
});

gulp.task('compile', gulp.series('cleanCompile', gulp.parallel(parallel)));

gulp.task(
  'js-lint',
  gulp.series('check-deps', (done) => {
    const fileList = (argv._ || []).slice(1);
    if (argv['js-lint'] === false) {
      return done();
    }
    const eslintBin = require.resolve('eslint/bin/eslint');
    let eslintConfig = path.join(__dirname, '../config/eslintrc.js');
    const projectEslint = resolveCwd('./.eslintrc');
    if (fs.existsSync(projectEslint)) {
      eslintConfig = projectEslint;
    }
    let args = [eslintBin, '-c', eslintConfig];
    if (fileList.length) {
      const regex = /\.jsx?$/i;
      const jsFiles = fileList.filter((file) => regex.test(file));
      if (!jsFiles.length) {
        done();
        return;
      }
      args = args.concat(jsFiles);
    } else {
      args = args.concat(['--ext', '.js,.jsx']);

      // eslint v5 will exit when not file find. We have to check first
      [src, 'tests', 'examples'].forEach((testPath) => {
        if (glob.sync(`${testPath}/**/*.{js,ssx}`).length) {
          args.push(testPath);
        }
      });
    }
    if (argv.fix) {
      args.push('--fix');
    }

    runCmd('node', args, done);
  })
);

gulp.task('lint', gulp.series('js-lint'));

function cleanBuild() {
  if (fs.existsSync(resolveCwd('build'))) {
    shelljs.rm('-rf', resolveCwd('build'));
  }
}

gulp.task('dist', (done) => {
  const entry = pkg.config && pkg.config.entry;
  if (!entry) {
    done();
    return;
  }
  let webpackConfig;
  const buildFolder = path.join(cwd, 'dist/');
  if (fs.existsSync(path.join(cwd, 'webpack.config.js'))) {
    webpackConfig = require(path.join(cwd, 'webpack.config.js'))(
      getWebpackConfig({
        common: false,
        inlineSourceMap: false,
      }),
      { phase: 'dist' }
    );
  } else {
    const output = pkg.config && pkg.config.output;
    if (output && output.library === null) {
      output.library = undefined;
    }
    webpackConfig = assign(
      getWebpackConfig({
        common: false,
        inlineSourceMap: false,
      }),
      {
        output: Object.assign(
          {
            path: buildFolder,
            filename: '[name].js',
            library: pkg.name,
            libraryTarget: 'umd',
            libraryExport: 'default',
          },
          output
        ),
        externals: {
          vue: {
            root: 'Vue',
            commonjs2: 'vue',
            commonjs: 'vue',
            amd: 'vue',
          },
        },
      }
    );
    const compressedWebpackConfig = Object.assign({}, webpackConfig);
    compressedWebpackConfig.entry = {};
    Object.keys(entry).forEach((e) => {
      compressedWebpackConfig.entry[`${e}.min`] = entry[e];
    });
    compressedWebpackConfig.plugins = webpackConfig.plugins.concat([
      new webpack.optimize.UglifyJsPlugin({
        compress: {
          screw_ie8: true, // Vue doesn't support IE8
          warnings: false,
        },
        mangle: {
          screw_ie8: true,
        },
        output: {
          comments: false,
          screw_ie8: true,
        },
      }),
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
      }),
    ]);
    webpackConfig.entry = entry;
    webpackConfig = [webpackConfig, compressedWebpackConfig];
  }
  measureFileSizesBeforeBuild(buildFolder).then((previousFileSizes) => {
    shelljs.rm('-rf', buildFolder);
    webpack(webpackConfig, (err, stats) => {
      if (err) {
        console.error('error', err);
      }
      stats.toJson().children.forEach(printResult);
      printFileSizesAfterBuild(stats, previousFileSizes, buildFolder);
      done(err);
    });
  });
});

// gulp.task('gh-pages', ['build'], done => {
//   console.log('gh-paging');
//   if (pkg.scripts['pre-gh-pages']) {
//     shelljs.exec('npm run pre-gh-pages');
//   }
//   if (fs.existsSync(resolveCwd('./examples/'))) {
//     const ghPages = require('gh-pages');
//     ghPages.publish(
//       resolveCwd('build'),
//       {
//         depth: 1,
//         logger(message) {
//           console.log(message);
//         },
//       },
//       () => {
//         cleanBuild();
//         console.log('gh-paged');
//         done();
//       }
//     );
//   } else {
//     done();
//   }
// });

// gulp.task('build', ['webpack'], () => {
//   if (fs.existsSync(resolveCwd('./examples/'))) {
//     const dir = resolveCwd('./examples/');
//     let files = fs.readdirSync(dir);
//     files = files
//       .filter(f => f[0] !== '~') // Remove '~tmp' file
//       .map(f => path.join(dir, f));
//     const filesMap = {};
//     files.forEach(f => {
//       filesMap[f] = 1;
//     });
//     files.forEach(f => {
//       if (f.match(/\.tsx?$/)) {
//         let js = f.replace(/\.tsx?$/, '.js');
//         if (filesMap[js]) {
//           delete filesMap[js];
//         }
//         js = f.replace(/\.tsx?$/, '.jsx');
//         if (filesMap[js]) {
//           delete filesMap[js];
//         }
//       }
//     });
//     return gulp
//       .src(Object.keys(filesMap))
//       .pipe(
//         jsx2example({
//           dest: 'build/examples/',
//         })
//       ) // jsx2example(options)
//       .pipe(gulp.dest('build/examples/'));
//   }
//   return undefined;
// });

function babelifyInternal(js, modules) {
  function replacer(match, m1, m2) {
    return `${m1}/assets/${m2}.css`;
  }

  const babelConfig = getBabelCommonConfig(modules);
  if (modules === false) {
    babelConfig.plugins.push(replaceLib);
  }

  let stream = js.pipe(babel(babelConfig));
  if (argv.compress) {
    stream = stream.pipe(minify());
  }
  return stream
    .pipe(
      through2.obj(function (file, encoding, next) {
        const contents = file.contents.toString(encoding).replace(lessPath, replacer);
        file.contents = Buffer.from(contents);
        this.push(file);
        next();
      })
    )
    .pipe(gulp.dest(modules !== false ? 'lib' : 'es'));
}

function babelify(modules) {
  const streams = [];
  const assets = gulp
    .src([`${src}/**/*.@(png|svg|less|d.ts)`])
    .pipe(gulp.dest(modules === false ? 'es' : 'lib'));
  if (glob.sync('src/**/*.{ts,tsx}').length && !glob.sync('src/**/*.d.ts').length) {
    let error = 0;
    let reporter = tsDefaultReporter;
    if (argv['single-run']) {
      reporter = {
        error(e) {
          tsDefaultReporter.error(e);
          error = e;
        },
        finish: tsDefaultReporter.finish,
      };
    }

    const tsResult = gulp
      .src([`${src}/**/*.ts`, `${src}/**/*.tsx`, 'typings/**/*.d.ts'])
      .pipe(ts(tsConfig, reporter));

    const check = () => {
      if (error) {
        console.error('compile error', error);
        process.exit(1);
      }
    };
    tsResult.on('finish', check);
    tsResult.on('end', check);

    streams.push(
      tsResult.dts
        // .pipe(require('gulp-debug')())
        .pipe(gulp.dest(modules === false ? 'es' : 'lib'))
    );
    streams.push(babelifyInternal(tsResult.js, modules));
  } else {
    streams.push(babelifyInternal(gulp.src([`${src}/**/*.js`, `${src}/**/*.jsx`]), modules));
  }
  return merge2(streams.concat([assets]));
}

gulp.task('check-deps', (done) => {
  if (argv['check-deps'] !== false) {
    require('./checkDep')(done);
  }
});

gulp.task(
  'publish',
  gulp.series('compile', (done) => {
    if (!fs.existsSync(resolveCwd('lib')) || !fs.existsSync(resolveCwd('es'))) {
      return done('missing lib/es dir');
    }
    console.log('publishing');
    const npm = argv.tnpm ? 'tnpm' : 'npm';
    const beta = !pkg.version.match(/^\d+\.\d+\.\d+$/);
    let args = [npm, 'publish', '--with-vc-tools'];
    if (beta) {
      args = args.concat(['--tag', 'beta']);
    } else if (argv.tag) {
      args = args.concat(['--tag', argv.tag]);
    }
    if (pkg.scripts['pre-publish']) {
      shelljs.exec(`npm run pre-publish`);
    }
    let ret = shelljs.exec(args.join(' ')).code;
    cleanCompile();
    console.log('published');
    if (!ret) {
      ret = undefined;
    }
    done(ret);
  })
);

gulp.task(
  'compile_watch',
  gulp.series('compile', (done) => {
    console.log('file changed');
    const outDir = argv['out-dir'];
    if (outDir) {
      fs.copySync(resolveCwd('lib'), path.join(outDir, 'lib'));
      fs.copySync(resolveCwd('es'), path.join(outDir, 'es'));
      if (fs.existsSync(resolveCwd('assets'))) {
        fs.copySync(resolveCwd('assets'), path.join(outDir, 'assets'));
      }
    }
    done();
  })
);

gulp.task('prettier', () => {
  return gulp
    .src(['./src/**/*.{js,jsx}', './tests/**/*.{js,jsx}', './examples/**/*.{js,jsx}'])
    .pipe(
      prettier.format(
        {
          printWidth: 100,
          useFlowParser: false,
          singleQuote: true,
          trailingComma: 'all',
        },
        {
          reporter: 'error',
        }
      )
    )
    .pipe(gulp.dest((file) => file.base));
});

gulp.task('pre-commit', gulp.series('prettier', 'lint'));

gulp.task(
  'pub',
  gulp.series('publish', (done) => {
    console.log('tagging');
    const { version } = pkg;
    shelljs.cd(cwd);
    shelljs.exec(`git tag ${version}`);
    shelljs.exec(`git push origin ${version}:${version}`);
    shelljs.exec('git push origin master:master');
    console.log('tagged');
    done();
  })
);
