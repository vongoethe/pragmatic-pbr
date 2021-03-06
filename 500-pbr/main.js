var Window       = require('pex-sys/Window');
var createSphere = require('primitive-sphere');
var createCube = require('primitive-cube');
var PerspCamera  = require('pex-cam/PerspCamera');
var Arcball      = require('pex-cam/Arcball');
var Draw         = require('pex-draw');
var glslify      = require('glslify-promise');
var Texture2D    = require('pex-context/Texture2D');
var TextureCube  = require('pex-context/TextureCube');
var GUI          = require('pex-gui');
var parseHdr     = require('../local_modules/parse-hdr');
var parseDds     = require('parse-dds');
var isBrowser    = require('is-browser');
var UberMaterial         = require('./UberMaterial');
var PBRImportanceSampled = require('./PBRImportanceSampled.js');
var PBRMaterial          = require('./PBRMaterial.js');
var renderToCubemap      = require('../local_modules/render-to-cubemap');
var downsampleCubemap   = require('../local_modules/downsample-cubemap');
var convolveCubemap     = require('../local_modules/convolve-cubemap');
var prefilterCubemap    = require('../local_modules/prefilter-cubemap');
var envmapToCubemap     = require('../local_modules/envmap-to-cubemap');
var parseObj            = require('../local_modules/geom-parse-obj/');
var computeNormals      = require('../local_modules/geom-compute-normals/')
var centerAndResize     = require('../local_modules/geom-center-and-resize/');
var Vec3                = require('pex-math/Vec3');
var hammersley          = require('hammersley');

function grid(x, y, w, h, nw, nh, margin){
    margin = margin || 0;
    var max =  nw * nh;
    var cw = Math.floor(w / nw);
    var ch = Math.floor(h / nh);
    var cells = [];
    for(var iy = 0; iy < nh; ++iy){
        for(var ix = 0; ix < nw; ++ix){
            cells.push([
                x + ix * cw + margin,
                y + iy * ch + margin,
                cw - 2 * margin,
                ch - 2 * margin
            ]);
        }
    }
    return cells;
}

var W = 800;
var H = 1000;

var ASSETS_DIR = isBrowser ? '../assets' :  __dirname + '/../assets';

var viewports = grid(180, 0, W-180, H, 1, 3);
var materials = [];


var State = {
    roughness: 0.5,
    metalness: 0,
    ior: 1.4,
    exposure: 1,
    albedo: [1.0, 0.86, 0.57, 1.0],
    lightColor: [0, 0, 0, 1.0]
}

Window.create({
    settings: {
        width: W,
        height: H
    },
    resources: {
        skyboxVert: { glsl: glslify(__dirname + '/glsl/SkyboxQuad.vert') },
        skyboxFrag: { glsl: glslify(__dirname + '/glsl/SkyboxQuad.frag') },
        showNormalsVert: { text: __dirname + '/glsl/ShowNormals.vert' },
        showNormalsFrag: { text: __dirname + '/glsl/ShowNormals.frag' },
        showColorsVert: { text: __dirname + '/glsl/ShowColors.vert' },
        showColorsFrag: { text: __dirname + '/glsl/ShowColors.frag' },
        specularPhongVert: { glsl: glslify(__dirname + '/glsl/SpecularPhong.vert') },
        specularPhongFrag: { glsl: glslify(__dirname + '/glsl/SpecularPhong.frag') },
        specularGGXVert: { glsl: glslify(__dirname + '/glsl/SpecularGGX.vert') },
        specularGGXFrag: { glsl: glslify(__dirname + '/glsl/SpecularGGX.frag') },
        specularCookTorranceVert: { glsl: glslify(__dirname + '/glsl/SpecularCookTorrance.vert') },
        specularCookTorranceFrag: { glsl: glslify(__dirname + '/glsl/SpecularCookTorrance.frag') },
        uberShaderVert: { glsl: glslify(__dirname + '/glsl/UberShader.vert') },
        uberShaderFrag: { glsl: glslify(__dirname + '/glsl/UberShader.frag') },
        reflectionMap: { binary: ASSETS_DIR + '/envmaps/garage.hdr' },
        irradianceMap: { binary: ASSETS_DIR + '/envmaps/garage_diffuse.hdr' },
        irradianceCubemap: { binary: ASSETS_DIR + '/envmaps_pmrem_dds/StPetersIrradiance.dds' }, //TEMP
        reflectionCubemap: { binary: ASSETS_DIR + '/envmaps_pmrem_dds/StPetersReflection.dds' }, //TEMP
        //irradianceCubemap: { binary: ASSETS_DIR + '/envmaps_pmrem_dds/simongeilfus/CathedralIrradiance.dds' }, //TEMP
        //reflectionCubemap: { binary: ASSETS_DIR + '/envmaps_pmrem_dds/simongeilfus/CathedralRadiance.dds' }, //TEMP
        blob: { text: ASSETS_DIR + '/models/blob.obj' },
        dragon: { text: ASSETS_DIR + '/models/dragon.obj' },
        brdfLut: { image: ASSETS_DIR + '/brdf/lut.png' }
    },
    init: function() {
        this.initMeshes();
        this.initMaterials();
        this.initGUI();
        this.initCamera();
    },
    initCamera: function() {
        this.camera = new PerspCamera(45, viewports[0][2] / viewports[0][3], 0.1, 100);
        this.camera.lookAt([0, 0.5, 4], [0, 0, 0], [0, 1, 0]);
        this.arcball = new Arcball(this.camera, W, H);
        this.addEventListener(this.arcball);
    },
    initMeshes: function() {
        var ctx = this.getContext();
        var res = this.getResources();

        var sphere = createSphere(0.6);
        var attributes = [
            { data: sphere.positions, location: ctx.ATTRIB_POSITION },
            { data: sphere.normals, location: ctx.ATTRIB_NORMAL },
            { data: sphere.uvs, location: ctx.ATTRIB_TEX_COORD_0 },
        ];
        var sphereIndices = { data: sphere.cells, usage: ctx.STATIC_DRAW };
        this.sphereMesh = ctx.createMesh(attributes, sphereIndices, ctx.TRIANGLES);

        var dragonGeom = parseObj(res.dragon);
        dragonGeom.positions = centerAndResize(dragonGeom.positions, 2);
        dragonGeom.normals = computeNormals(dragonGeom.positions, dragonGeom.cells)
        dragonGeom.uvs = dragonGeom.normals;
        var attributes = [
            { data: dragonGeom.positions, location: ctx.ATTRIB_POSITION },
            { data: dragonGeom.normals, location: ctx.ATTRIB_NORMAL },
            { data: dragonGeom.uvs, location: ctx.ATTRIB_TEX_COORD_0 },
        ];
        var dragonIndices = { data: dragonGeom.cells, usage: ctx.STATIC_DRAW };
        this.dragonMesh = ctx.createMesh(attributes, dragonIndices, ctx.TRIANGLES);

        var blob = parseObj(res.blob);
        var attributes = [
            { data: blob.positions, location: ctx.ATTRIB_POSITION },
            { data: blob.normals, location: ctx.ATTRIB_NORMAL },
            { data: blob.uvs, location: ctx.ATTRIB_TEX_COORD_0 },
        ];
        var blobIndices = { data: blob.cells, usage: ctx.STATIC_DRAW };
        this.blobMesh = ctx.createMesh(attributes, blobIndices, ctx.TRIANGLES);

        var skyboxPositions = [[-1,-1],[1,-1], [1,1],[-1,1]];
        var skyboxFaces = [ [0, 1, 2], [0, 2, 3]];
        var skyboxAttributes = [
            { data: skyboxPositions, location: ctx.ATTRIB_POSITION },
        ];
        var skyboxIndices = { data: skyboxFaces };
        this.skyboxMesh = ctx.createMesh(skyboxAttributes, skyboxIndices);
    },
    initMaterials: function() {
        var ctx = this.getContext();
        var res = this.getResources();

        var numSamples = 512;
        var hammersleyPointSet = new Float32Array(4 * numSamples);
        for(var i=0; i<numSamples; i++) {
            var p = hammersley(i, numSamples)
            hammersleyPointSet[i*4]   = p[0];
            hammersleyPointSet[i*4+1] = p[1];
            hammersleyPointSet[i*4+2] = 0;
            hammersleyPointSet[i*4+3] = 0;
        }

        this.hammersleyPointSetMap = ctx.createTexture2D(hammersleyPointSet, 1, numSamples, { type: ctx.FLOAT, magFilter: ctx.NEAREST, minFilter: ctx.NEAREST });

        var irradianceMapInfo = parseHdr(res.irradianceMap);
        var irradianceMap = this.irradianceMap = ctx.createTexture2D(irradianceMapInfo.data, irradianceMapInfo.shape[0], irradianceMapInfo.shape[1], {
            type: ctx.FLOAT
        });

        var reflectionMapInfo = parseHdr(res.reflectionMap);
        var reflectionMap = this.reflectionMap = ctx.createTexture2D(reflectionMapInfo.data, reflectionMapInfo.shape[0], reflectionMapInfo.shape[1], {
            type: ctx.FLOAT
        });


        //TEMP
        var irradianceCubemapInfo = parseDds(res.irradianceCubemap);
        var numMipmapLevels = irradianceCubemapInfo.images.length / 6;
        var faces = [];
        for(var faceIndex=0; faceIndex<6; faceIndex++) {
          for(var mipmapLevel=0; mipmapLevel<numMipmapLevels; mipmapLevel++) {
              var faceInfo = irradianceCubemapInfo.images[faceIndex * numMipmapLevels + mipmapLevel];
              faces.push({
                  width: faceInfo.shape[0],
                  height: faceInfo.shape[1],
                  face: faceIndex,
                  lod: mipmapLevel,
                  data: new Float32Array(res.irradianceCubemap.slice(faceInfo.offset, faceInfo.offset + faceInfo.length))
              })
          }
        }
        var irradianceCubemap = this.irradianceCubemap = ctx.createTextureCube(faces, irradianceCubemapInfo.shape[0], irradianceCubemapInfo.shape[1], {
            type: ctx.FLOAT
        });

        //TEMP
        //TODO: remove this loading code, always go from envmap?
        var reflectionCubemapInfo = parseDds(res.reflectionCubemap);
        var numMipmapLevels = reflectionCubemapInfo.images.length / 6;
        var faces = [];
        for(var faceIndex=0; faceIndex<6; faceIndex++) {
          for(var mipmapLevel=0; mipmapLevel<numMipmapLevels; mipmapLevel++) {
              var faceInfo = reflectionCubemapInfo.images[faceIndex * numMipmapLevels + mipmapLevel];
              faces.push({
                  width: faceInfo.shape[0],
                  height: faceInfo.shape[1],
                  face: faceIndex,
                  lod: mipmapLevel,
                  data: new Float32Array(res.reflectionCubemap.slice(faceInfo.offset, faceInfo.offset + faceInfo.length))
              })
          }
        }
        var reflectionCubemap = this.reflectionCubemap = ctx.createTextureCube(faces, reflectionCubemapInfo.shape[0], reflectionCubemapInfo.shape[1], {
            type: ctx.FLOAT,
            //minFilter: ctx.LINEAR_MIPMAP_LINEAR
            minFilter: ctx.LINEAR_MIPMAP_NEAREST
        });



        var CUBEMAP_SIZE = 256;

        //TODO: seamless cubemap sampling would help...
        //this.reflectionCubemap = ctx.createTextureCube(null, CUBEMAP_SIZE, CUBEMAP_SIZE, { type: ctx.FLOAT, minFilter: ctx.NEAREST, magFilter: ctx.NEAREST });
        this.reflectionPREM = ctx.createTextureCube(null, CUBEMAP_SIZE, CUBEMAP_SIZE, { type: ctx.FLOAT, minFilter: ctx.NEAREST, magFilter: ctx.NEAREST });
        this.reflectionMap128 = ctx.createTextureCube(null, CUBEMAP_SIZE/2, CUBEMAP_SIZE/2, { type: ctx.FLOAT, minFilter: ctx.NEAREST, magFilter: ctx.NEAREST });
        this.reflectionMap64 = ctx.createTextureCube(null, CUBEMAP_SIZE/4, CUBEMAP_SIZE/4, { type: ctx.FLOAT, minFilter: ctx.NEAREST, magFilter: ctx.NEAREST });
        this.reflectionMap32 = ctx.createTextureCube(null, CUBEMAP_SIZE/8, CUBEMAP_SIZE/8, { type: ctx.FLOAT, minFilter: ctx.NEAREST, magFilter: ctx.NEAREST });
        this.reflectionMap16 = ctx.createTextureCube(null, CUBEMAP_SIZE/16, CUBEMAP_SIZE/16, { type: ctx.FLOAT, minFilter: ctx.NEAREST, magFilter: ctx.NEAREST });
        this.irradianceCubemapConv = ctx.createTextureCube(null, CUBEMAP_SIZE/16, CUBEMAP_SIZE/16, { type: ctx.FLOAT });
        this.brdfLut = ctx.createTexture2D(res.brdfLut, res.brdfLut.width, res.brdfLut.height, { flip: true });

        //envmapToCubemap(ctx, this.reflectionMap, this.reflectionCubemap); //render envmap to cubemap
        ctx.bindTexture(this.reflectionCubemap);
        var gl = ctx.getGL();
        gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
        gl.texParameterf(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR );

        ctx.bindTexture(this.reflectionPREM);
        var gl = ctx.getGL();
        gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
        gl.texParameterf(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
        gl.texParameterf(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR );

        downsampleCubemap(ctx, this.reflectionCubemap, this.reflectionMap128);
        downsampleCubemap(ctx, this.reflectionMap128, this.reflectionMap64);
        downsampleCubemap(ctx, this.reflectionMap64,  this.reflectionMap32);
        downsampleCubemap(ctx, this.reflectionMap32,  this.reflectionMap16);
        convolveCubemap(ctx,   this.reflectionMap16,  this.irradianceCubemapConv);
        prefilterCubemap(ctx,   this.reflectionCubemap,  this.reflectionPREM);
        //this.reflectionPREM = this.reflectionCubemap
        //this.irradianceCubemap = this.irradianceCubemapConv;

        this.showColorsProgram = ctx.createProgram(res.showColorsVert, res.showColorsFrag)
        this.skyboxProgram = ctx.createProgram(res.skyboxVert, res.skyboxFrag)

        this.debugDraw = new Draw(ctx);

        materials.push(new PBRMaterial(ctx, {
            name: 'fresnel',
            uIrradianceMap: this.irradianceCubemapConv,
            uReflectionMap: this.reflectionPREM,
            uAlbedoColor: [1.0, 0.86, 0.57, 1.0],
            uLightColor: [1, 1, 1, 1.0],
            uHammersleyPointSetMap: this.hammersleyPointSetMap,
            uBrdfLut: this.brdfLut,
            uUE4Prefiltered: true
        }))

        //materials.push(new UberMaterial(ctx, {
        //    name: 'reflection',
        //    uIrradianceMap: this.irradianceCubemap,
        //    uReflectionMap: this.reflectionCubemap,
        //    uAlbedoColor: [1.0, 0.86, 0.57, 1.0],
        //    uLightColor: [1, 1, 1, 1.0],
        //    uHammersleyPointSetMap: this.hammersleyPointSetMap,
        //    uBrdfLut: this.brdfLut,
        //    uUE4: true
        //}))
        materials.push(new PBRImportanceSampled(ctx, {
            name: 'reflection',
            uIrradianceMap: this.irradianceCubemap,
            uReflectionMap: this.reflectionCubemap,
            uAlbedoColor: [1.0, 0.86, 0.57, 1.0],
            uLightColor: [1, 1, 1, 1.0],
            uHammersleyPointSetMap: this.hammersleyPointSetMap,
            uBrdfLut: this.brdfLut,
            uUE4: true
        }))
    },
    initGUI: function() {
        var ctx = this.getContext();

        var gui = this.gui = new GUI(ctx, W, H);
        this.addEventListener(gui)

        this.gui.addTexture2D('Reflection Map', this.reflectionMap)
        this.gui.addTextureCube('Reflection Map 128', this.reflectionMap128)
        this.gui.addTextureCube('Reflection Map 64', this.reflectionMap64)
        this.gui.addTextureCube('Reflection Map 32', this.reflectionMap32)
        this.gui.addTextureCube('Irradiance CubeMap', this.irradianceCubemap)
        this.gui.addTextureCube('Irradiance CubeMap Conv', this.irradianceCubemapConv)
        this.gui.addTextureCube('Reflection PREM', this.reflectionPREM)

        this.gui.addParam('roughness', State, 'roughness', { min: 0, max: 1}, function(value) {
            materials.forEach(function(material, i) {
                material.uniforms.uRoughness = value;
            })
        })

        this.gui.addParam('metalness', State, 'metalness', { min: 0, max: 1}, function(value) {
            materials.forEach(function(material, i) {
                material.uniforms.uMetalness = value;
            })
        })

        this.gui.addParam('ior', State, 'ior', { min: 1, max: 5}, function(value) {
            materials.forEach(function(material, i) {
                material.uniforms.uIor = value;
            })
        })

        this.gui.addParam('exposure', State, 'exposure', { min: 0, max: 3}, function(value) {
            materials.forEach(function(material, i) {
                material.uniforms.uExposure = value;
            })
        })

        this.gui.addParam('albedo', State, 'albedo', { type: 'color' }, function(value) {
            materials.forEach(function(material, i) {
                material.uniforms.uAlbedoColor = value;
            })
        })

        this.gui.addParam('lightColor', State, 'lightColor', { min: 0, max:10 }, function(value) {
            materials.forEach(function(material, i) {
                material.uniforms.uLightColor = value;
            })
        })
    },
    onKeyPress: function(e) {
        if (e.str == 'g') {
            this.gui.toggleEnabled();
        }
    },
    draw: function() {
        var ctx = this.getContext();
        var dbg = this.debugDraw;

        this.arcball.apply();
        ctx.setProjectionMatrix(this.camera.getProjectionMatrix());
        ctx.setViewMatrix(this.camera.getViewMatrix());

        ctx.setDepthTest(true);

        for(var i in viewports) {
            var viewport = viewports[i];
            var material = materials[i];
            if (!material) {
                break;
            }

            ctx.pushState(ctx.VIEWPORT_BIT | ctx.SCISSOR_BIT);
            //flipping Y as viewport starts in bottom left
            var H = this.getHeight();
            ctx.setViewport(viewport[0], H - viewport[1] - viewport[3], viewport[2], viewport[3])
            ctx.setScissorTest(true)
            ctx.setScissor(viewport[0], H - viewport[1] - viewport[3], viewport[2], viewport[3])
            ctx.setClearColor(0.4, 0.1, 0.1, 0.0);
            ctx.setClearColor(material.uniforms.uAlbedoColor[0], material.uniforms.uAlbedoColor[1], material.uniforms.uAlbedoColor[2], 0.0);
            ctx.clear(ctx.COLOR_BIT | ctx.DEPTH_BIT);

            if (material.uniforms && material.uniforms.uReflectionMap) {
                ctx.pushState(ctx.DEPTH_BIT);
                ctx.setDepthTest(false);
                ctx.bindProgram(this.skyboxProgram);
                this.skyboxProgram.setUniform('uExposure', material.uniforms.uExposure)
                this.skyboxProgram.setUniform('uEnvMap', 0)
                ctx.bindTexture(material.uniforms.uReflectionMap, 0)
                ctx.bindMesh(this.skyboxMesh);
                ctx.drawMesh()
                ctx.popState(ctx.DEPTH_BIT);
            }

            ctx.bindProgram(material.program);
            var numTextures = 0;
            for(var uniformName in material.uniforms) {
                var value = material.uniforms[uniformName];
                if ((value instanceof Texture2D) || (value instanceof TextureCube)) {
                    ctx.bindTexture(value, numTextures);
                    value = numTextures++;
                }
                if (material.program.hasUniform(uniformName)) {
                    material.program.setUniform(uniformName, value)
                }
            }

            ctx.pushModelMatrix();
            ctx.translate([-2, 0, 0])
            ctx.bindMesh(this.dragonMesh);
            ctx.drawMesh();
            ctx.popModelMatrix();

            ctx.pushModelMatrix();
            ctx.bindMesh(this.sphereMesh);
            ctx.drawMesh();
            ctx.popModelMatrix();

            ctx.pushModelMatrix();
            ctx.translate([ 2, 0, 0])
            ctx.bindMesh(this.blobMesh);
            ctx.drawMesh();
            ctx.popModelMatrix();


            ctx.bindProgram(this.showColorsProgram);
            dbg.setColor([1,1,1,1])
            dbg.drawGrid(5);
            dbg.drawPivotAxes(2)
            dbg.setColor([1,1,1,1])
            var L = Vec3.normalize([10,10,0]);
            var V = Vec3.normalize(Vec3.copy(this.camera.getPosition()))
            var H = Vec3.normalize(Vec3.add(Vec3.copy(V), L));
            dbg.drawVector(Vec3.scale(L, 2));
            dbg.setColor([1,1,0,1])
            dbg.drawVector(Vec3.scale(H, 2));


            ctx.popState(ctx.VIEWPORT_BIT | ctx.SCISSOR_BIT);
        }

        this.gui.draw();
    }
})
