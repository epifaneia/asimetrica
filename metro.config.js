// @ts-check
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Incluye extensiones de modelo y voces para require() / import estáticos.
config.resolver.assetExts = [...config.resolver.assetExts, 'onnx', 'ort', 'bin'];

module.exports = config;
