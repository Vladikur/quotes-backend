function floatArrayToBuffer(arr) {
    // Если уже Float32Array — zero-copy
    if (arr instanceof Float32Array) {
        return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    }

    // Если обычный JS-массив — один проход, без writeFloatLE
    const float32 = Float32Array.from(arr);
    return Buffer.from(float32.buffer);
}

module.exports = floatArrayToBuffer;
