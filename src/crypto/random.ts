/// <reference path='../third_party/typings/webcrypto/WebCrypto.d.ts' />

module Random {
  // Small convenience wrapper for WebCrypto random Uint32.
  export var randomUint32 = () : number => {
    var randomArray = new Uint32Array(1);
    crypto.getRandomValues(randomArray);
    return randomArray[0];
  }
}
