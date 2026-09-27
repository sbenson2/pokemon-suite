// A timing cache is only a hint. Requalify a stale cache once against the same
// owner checkpoint; never apply a plan until the usual native replays pass.
export async function qualifyRngWithCalibration({qualify,profile,signal,onProgress=()=>{}}){
 try{return await qualify(profile);}
 catch(error){
  if(!profile||signal?.aborted||error.message!=='Teachy TV rate changed; recalibration required')throw error;
  onProgress({method:'automatic',phase:'recalibrating',reason:'Cached timing changed; measuring this checkpoint again'});
  return qualify(null);
 }
}
