var Mimic = require('../');
var assert = require('assert');
var sinon = require('sinon');
var path = require('path');
var Module = require('module');
describe('mimic', function () {
    var sandbox;
    beforeEach(function () {
        process.chdir(__dirname);
        sandbox = sinon.sandbox.create();
    });
    afterEach(function () {
        Mimic.restore();
        sandbox.restore();
    });
    describe('uninstall warnings', function () {
        var m1;
        var m2;
        beforeEach(function () {
            m1 = new Mimic();
            m2 = new Mimic();
            m1.install();
            m2.install();
            sandbox.stub(console, 'warn');
        });
        it('should console.warn when uninstalling a Module.prototype.require that it didnt install', function () {
            m1.uninstall();
            sinon.assert.called(console.warn);
        });
        it('should not console.warn when uninstalling a Module.prototype.require in the correct (reverse) order', function () {
            m2.uninstall();
            m1.uninstall();
            sinon.assert.notCalled(console.warn);
        });
    });
    describe('webpack alias transforms', function () {
        it('should work with module names', function () {
            var m = new Mimic({webpackConfig: {resolve: {alias: {foo: 'bar'}}}}).install();
            sandbox.stub(m, '_originalRequire');
            require('foo');
            sinon.assert.calledWith(m._originalRequire, 'bar');
            require('foo/test-modules/empty-bar-module');
            sinon.assert.calledWith(m._originalRequire, 'bar/test-modules/empty-bar-module');
        });
        it('should work with file names when the file extension is present', function () {
            var m = new Mimic({webpackConfig: {resolve: {alias: {foo: 'bar.js'}}}}).install();
            sandbox.stub(m, '_originalRequire');
            require('foo');
            sinon.assert.calledWith(m._originalRequire, 'bar.js');
        });
    });
    it('should use resolve.extensions to resolve paths', function () {
        var m = new Mimic({
            webpackConfig: {
                resolve: {
                    extensions: ['.bar']
                }
            }
        }).install();
        assert.equal(path.extname(require.resolve('./test-modules/empty-bar-module')), '.bar');
        delete require.cache[require.resolve('./test-modules/empty-bar-module')];
        m.uninstall();
        assert.throws(function () {
            require.resolve('./test-modules/another-empty-bar-module'); // using another file because we can no longer make previously resolved paths unresolvable
        }, Error);
    });
    describe('webpack loader transforms', function () {
        afterEach(function () {
            delete require.cache[require.resolve('./test-modules/raw-content')];
        });
        it('should apply webpack loaders according to the matcher', function () {
            var loaderSpy = sinon.spy();
            var m = new Mimic({
                webpackConfig: {
                    resolve: {
                        extensions: ['.nojs']
                    },
                    module: {
                        loaders: [
                            {
                                test: /\.nojs/,
                                loader: loaderSpy
                            }
                        ]
                    }
                }
            }).install();
            sandbox.stub(Module.prototype, '_compile');
            require('./test-modules/raw-content');
            sinon.assert.calledWith(
                loaderSpy,
                'thisisatest'
            );
        });
        it('should run loaders through the normalizer', function () {
            var myLoader = [];
            sandbox.stub(Mimic.prototype, 'normalizeLoaders', Mimic.prototype.normalizeLoaders);
            var m = new Mimic({
                webpackConfig: {
                    resolve: {
                        extensions: ['.nojs']
                    },
                    module: {
                        loaders: [
                            {
                                test: /\.nojs/,
                                loader: myLoader
                            }
                        ]
                    }
                }
            }).install();
            sandbox.stub(Module.prototype, '_compile');
            require('./test-modules/raw-content');
            assert.equal(m.normalizeLoaders.firstCall.args[0].loader, myLoader);
        });
    });
    describe('normalizeLoaders', function () {
        var mimic;
        beforeEach(function () {
            m = new Mimic();
        });
        it('should handle single functions', function () {
            var m = new Mimic();
            var loaderSpy = {loader: sinon.spy(function () {
                return 'bar';
            })};
            var bigLoader = m.normalizeLoaders(loaderSpy);
            assert.equal(bigLoader('foo'), 'bar');
            sinon.assert.calledWith(loaderSpy.loader, 'foo');
        });
        it('should handle exclamation separated strings', function () {
            var bigLoader = m.normalizeLoaders({loader: './test-loaders/foo-exporter!./test-loaders/bar-append'});
            assert.equal(bigLoader('asdf'), 'asdfbar;module.exports="foo";');
        });
        it('should handle arrays of functions', function () {
            var bigLoader = m.normalizeLoaders({loader: [
                function (content) {return content + 'func1';},
                function (content) {return content + 'func2';}
            ]});
            assert.equal(bigLoader('asdf'), 'asdffunc2func1');
        });
        it('should support functions that use this.callback', function () {
            var bigLoader = m.normalizeLoaders({loader: [
                function (content) {
                    return this.callback(null, content + 'func1');
                },
                function (content) {return content + 'func2';}
            ]});
            assert.equal(bigLoader('asdf'), 'asdffunc2func1');
        });
    });
    describe('options.loaders.use', function () {
        it('should not use loaders that arent in the use list', function () {
            m = new Mimic({
                loaders: {
                    use: ['./test-loaders/bar-append']
                },
                webpackConfig: {
                    resolve: {
                        extensions: ['.bar']
                    },
                    module: {
                        loaders: [{
                            test: /\.bar$/,
                            loader: './test-loaders/foo-exporter'
                        }]
                    }
                }
            }).install();
            assert.deepEqual(require('./test-modules/empty-bar-module'), {});
        });
        it('should use loaders that are in the use list', function () {
            m = new Mimic({
                loaders: {
                    use: ['./test-loaders/foo-exporter-loader']
                },
                webpackConfig: {
                    resolve: {
                        extensions: ['.bar']
                    },
                    module: {
                        loaders: [{
                            test: /\.bar$/,
                            loader: './test-loaders/foo-exporter'
                        }]
                    }
                }
            }).install();
            assert.deepEqual(require('./test-modules/foo-true-bar-module'), 'foo');
        });
    });
    describe('options.loaders.identity', function () {
        it('should use the identity loader for options.loaders.identity', function () {
            m = new Mimic({
                loaders: {
                    identity: ['./test-loaders/bar-true-loader']
                },
                webpackConfig: {
                    resolve: {
                        extensions: ['.foo']
                    },
                    module: {
                        loaders: [{
                            test: /\.foo$/,
                            loader: './test-loaders/bar-true'
                        }]
                    }
                }
            }).install();
            assert.deepEqual(require('./test-modules/foo-true-exporter-foo-file'), {foo:true});
            delete require.cache[require.resolve('./test-modules/foo-true-exporter-foo-file')];
        });
    });
    describe('options.loaders.null', function () {
        it('should use the null loader for loaders not in options.loaders.use', function () {
            m = new Mimic({
                loaders: {
                    use: []
                },
                webpackConfig: {
                    resolve: {
                        extensions: ['.foo']
                    },
                    module: {
                        loaders: [{
                            test: /\.foo$/,
                            loader: './test-loaders/bar-true'
                        }]
                    }
                }
            }).install();
            assert.deepEqual(require('./test-modules/foo-true-exporter-foo-file'), {});
            assert.deepEqual(require('./test-modules/exports-somejsfile-module'), 'somejsfile');
        });
    });
});