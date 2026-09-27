import {createHash} from 'node:crypto';
import {deflateSync,inflateSync} from 'node:zlib';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digestPattern=/^[a-f0-9]{64}$/;
const size=(width,height)=>Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&
  width<=1024&&height<=1024?width*height*4:0;

// Presentation only: native state/SRAM and frame counters remain untouched.
export function captureSavePreview({session,stateSha256}) {
  const {width,height,rgba}=session.videoFrame(),bytes=size(width,height);
  if(!bytes||rgba?.length!==bytes||!rgba.some(value=>value!==0)||!digestPattern.test(stateSha256))return null;
  return {schema:'pokemon-suite/save-preview/v1',frame:session.frame,stateSha256,width,height,
    sha256:hash(rgba),data:deflateSync(rgba,{level:1}).toString('base64')};
}

function restore(checkpoint) {
  const preview=checkpoint?.metadata?.preview;
  if(!preview||preview.schema!=='pokemon-suite/save-preview/v1'||
      preview.stateSha256!==checkpoint.stateSha256||!digestPattern.test(preview.stateSha256)||
      !Number.isSafeInteger(preview.frame)||preview.frame<0||preview.frame!==checkpoint.metadata.frame||
      typeof preview.data!=='string'||preview.data.length>6*1024*1024)return null;
  const bytes=size(preview.width,preview.height);if(!bytes)return null;
  try{
    const rgba=inflateSync(Buffer.from(preview.data,'base64'),{maxOutputLength:bytes});
    if(rgba.length!==bytes||hash(rgba)!==preview.sha256)return null;
    return {frame:preview.frame,width:preview.width,height:preview.height,rgba};
  }catch{return null;}
}

export function createRestoredVideoSession({session,checkpoint}) {
  let preview=restore(checkpoint);
  return {
    get frame(){return session.frame;},
    videoFrame(){
      const native=session.videoFrame();
      if(preview&&(session.frame!==preview.frame||native.width!==preview.width||native.height!==preview.height||
          native.rgba.some(value=>value!==0)))preview=null;
      return preview?{width:preview.width,height:preview.height,rgba:Uint8Array.from(preview.rgba)}:native;
    },
  };
}
