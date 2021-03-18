#!/usr/bin/env node

const os = require('os');
const program = require('commander');
const chalk = require('chalk');

program.on('--help', () => {
  console.log('  Usage:'.to.bold.blue.color);
  console.log();
  console.log('    $', 'vc-tools run lint'.to.magenta.color, 'lint source within lib');
  console.log('    $', 'vc-tools run pub'.to.magenta.color, 'publish component');
  console.log('    $', 'vc-tools run server'.to.magenta.color, 'start server');
  console.log('    $', 'vc-tools run chrome-test'.to.magenta.color, 'run chrome tests');
  console.log();
});

program.parse(process.argv);

function runTask(toRun) {
  const gulp = require('gulp');
  const metadata = { task: toRun };
  // Gulp >= 4.0.0 (doesn't support events)
  const taskInstance = gulp.task(toRun);
  if (taskInstance === undefined) {
    gulp.emit('task_not_found', metadata);
    return;
  }
  const start = process.hrtime();
  gulp.emit('task_start', metadata);
  try {
    taskInstance.apply(gulp);
    metadata.hrDuration = process.hrtime(start);
    gulp.emit('task_stop', metadata);
    gulp.emit('stop');
  } catch (err) {
    err.hrDuration = process.hrtime(start);
    err.task = metadata.task;
    gulp.emit('task_err', err);
  }
}

const task = program.args[0];

if (!task) {
  program.help();
} else if (task === 'server') {
  const base = process.env.npm_package_config_base || '';
  const protocol = process.env.npm_package_config_protocol || 'http';
  const hostname = process.env.npm_package_config_host || 'localhost';
  const port = process.env.npm_package_config_port || 8000;
  const interfaces = os.networkInterfaces();
  Object.keys(interfaces).forEach(key =>
    (interfaces[key] || [])
      .filter(details => details.family === 'IPv4')
      .map(detail => {
        return {
          type: detail.address.includes('127.0.0.1') ? 'Local:   ' : 'Network: ',
          host: detail.address.replace('127.0.0.1', hostname),
        };
      })
      .forEach(({ type, host }) => {
        const url = `${protocol}://${host}:${chalk.bold(port)}${base}`;
        console.log(`  > ${type} ${chalk.cyan(url)}`);
      })
  );

  const app = require('../server/')();
  app.listen(port);
} else {
  console.log('vc-tools run', task);
  require('../gulpfile');
  runTask(task);
}
