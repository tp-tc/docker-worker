var dockerOpts = require('dockerode-options');
var path = require('path');
var util = require('util');

var JsonStream = require('json-stream');
var Promise = require('promise');
var Docker = require('dockerode-promise');
var DockerProc = require('dockerode-process');

function waitForMessage(listener, event, data) {
  return new Promise(function(accept) {
    listener.on(event, function filter(value) {
      if (value.toString().indexOf(data) !== -1) {
        listener.removeListener(event, filter);
        return accept();
      }
      process.stdout.write(value);
    });
  });
}

// Environment varibles to copy over to the docker instance.
var COPIED_ENV = [
  'DEBUG',
  'DOCKER_HOST',
  'AZURE_STORAGE_ACCOUNT',
  'AZURE_STORAGE_ACCESS_KEY'
];

function eventPromise(listener, event) {
  return new Promise(function(accept, reject) {
    listener.on(event, function(message) {
      accept(message);
    });
  });
}

function DockerWorker(provisionerId, workerType) {
  this.provisionerId = provisionerId;
  this.workerType = workerType;
  this.docker = new Docker(dockerOpts());
}

DockerWorker.prototype = {
  launch: function* () {
    var createConfig = {
      name: this.workerType,
      Image: 'taskcluster/docker-worker-test',
      Cmd: [
        '/bin/bash', '-c',
         [
          'node --harmony /worker/bin/worker.js',
          '-c 1',
          '--host test',
          '--worker-group', 'random-local-worker',
          '--worker-id', this.workerType,
          '--provisioner-id', this.provisionerId,
          '--worker-type', this.workerType
         ].join(' ')
      ],
      Env: [
        'DOCKER_CONTAINER_ID=' + this.workerType,
        'NODE_ENV=test'
      ],
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true
    };

    // Copy enviornment variables over.
    COPIED_ENV.forEach(function(key) {
      if (!(key in process.env)) return;
      createConfig.Env.push(util.format('%s=%s', key, process.env[key]));
    });

    var startConfig = {
      Binds: [
        util.format('%s:%s', path.resolve(__dirname, '..'), '/worker')
      ]
    };

    // If docker is supposed to connect over a socket set the socket as a bind
    // mount...
    var opts = dockerOpts();
    if (opts.socketPath) {
      startConfig.Binds.push(util.format(
        '%s:%s',
        opts.socketPath, '/var/run/docker.sock'
      ));
    }

    var proc = this.process = new DockerProc(this.docker, {
      create: createConfig,
      start: startConfig
    });

    proc.run();
    return proc;
  },

  terminate: function* () {
    if (this.process) {
      var proc = this.process;
      // Ensure the container is killed and removed.
      yield proc.container.kill();
      yield proc.container.remove();
      this.process = null;
    }
  }
};

// Export DockerWorker
module.exports = DockerWorker;
