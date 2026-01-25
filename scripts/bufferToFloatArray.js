function bufferToFloatArray(buf) {
    return new Float32Array(
        buf.buffer,
        buf.byteOffset,
        buf.byteLength / 4
    );
}

module.exports = bufferToFloatArray;