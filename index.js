'use strict';

var deprecate = require('util').deprecate;

module.exports = deprecate(function mixin(app) {
  app.loopback.modelBuilder.mixins.define('CreateNested', require('./create-nested'));
}, 'DEPRECATED: Use mixinSources, see https://github.com/rocknrolla777/loopback-cascade-delete-mixin#mixinsources');
