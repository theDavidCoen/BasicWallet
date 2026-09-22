module.exports = function (api) {
  api.cache(true);
  // babel-preset-expo auto-adds react-native-worklets/plugin when the package
  // is installed. Do not also list react-native-reanimated/plugin here (same
  // plugin) — double application breaks NativeWorklets unpackers.
  return {
    presets: ["babel-preset-expo"],
  };
};
