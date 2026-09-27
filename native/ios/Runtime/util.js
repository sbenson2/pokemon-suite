// The campaign commitment contract contains plain data and ordered arrays.
// Object insertion order must not change its semantic comparison on restore.
export function isDeepStrictEqual(a,b){
 if(Object.is(a,b))return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const left=Object.keys(a),right=Object.keys(b);
 return left.length===right.length&&left.every(key=>Object.hasOwn(b,key)&&isDeepStrictEqual(a[key],b[key]));
}
