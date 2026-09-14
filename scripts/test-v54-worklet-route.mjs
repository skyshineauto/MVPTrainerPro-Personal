import fs from 'node:fs';
import vm from 'node:vm';
const workletPath=process.argv[2]||'public/audioV2/mvpHdV2.worklet.js';
const wasmPath=process.argv[3]||'public/audioV2/mvpHdV2.wasm';
const code=fs.readFileSync(workletPath,'utf8');
const wasm=fs.readFileSync(wasmPath);
class Port { constructor(){this.onmessage=null;this.messages=[];} postMessage(m){this.messages.push(m);} send(m){this.onmessage?.({data:m});} }
class AudioWorkletProcessor { constructor(){this.port=new Port();} }
let Proc=null;
const ctx={AudioWorkletProcessor,registerProcessor:(n,c)=>{if(n==='mvp-hd-v2-processor')Proc=c;},sampleRate:48000,WebAssembly,Math,Float32Array,ArrayBuffer,Number,Boolean,String,JSON,Error,console};
vm.createContext(ctx);vm.runInContext(code,ctx,{filename:'mvpHdV2.worklet.js'});
if(!Proc)throw Error('processor not registered');
const p=new Proc();
const ab=wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength);
p.port.send({type:'INIT_WASM',wasmBytes:ab});
for(let i=0;i<100 && !p.ready;i++) await new Promise(r=>setTimeout(r,10));
if(!p.ready)throw Error('not ready '+JSON.stringify(p.port.messages));
const state={mode:'power',outputProfile:'headphones',intensity:.78,bassEnabled:true,bassCharacter:.6,impactEnabled:true,clarityEnabled:true,spatialEnabled:true,spaceMode:'studio',personalEnabled:true,personalBass:.4,personalPresence:.3,personalBrightness:.2,eqEnabled:true,eqGains:new Array(31).fill(0).map((v,i)=>i===17?4:0)};
p.port.send({type:'SET_STATE',revision:42,state});
const ack=p.port.messages.find(m=>m.type==='STATE_APPLIED'&&m.revision===42);if(!ack)throw Error('missing ack');
const fields=['mode','outputProfile','intensity','bassEnabled','bassCharacter','impactEnabled','clarityEnabled','spatialEnabled','spaceMode','personalEnabled','personalBass','personalPresence','personalBrightness','eqEnabled'];
for(const k of fields){if(JSON.stringify(ack.appliedState[k])!==JSON.stringify(state[k]))throw Error(`ACK mismatch ${k}: ${ack.appliedState[k]} != ${state[k]}`);}
if(typeof ack.signature!=='string'||ack.signature.length<20)throw Error('missing signature');
const N=128,inputL=new Float32Array(N),inputR=new Float32Array(N);for(let i=0;i<N;i++){const t=i/48000;inputL[i]=.25*Math.sin(2*Math.PI*110*t)+.15*Math.sin(2*Math.PI*3400*t);inputR[i]=.24*Math.sin(2*Math.PI*110*t+.1)+.14*Math.sin(2*Math.PI*3400*t+.3);}const outL=new Float32Array(N),outR=new Float32Array(N);p.process([[inputL,inputR]],[[outL,outR]]);let diff=0;for(let i=0;i<N;i++)diff+=Math.abs(outL[i]-inputL[i]);if(diff<.01)throw Error('worklet output did not change');
p.port.send({type:'PING'});const pong=p.port.messages.findLast?.(m=>m.type==='PONG')??[...p.port.messages].reverse().find(m=>m.type==='PONG');if(!pong||pong.signature!==ack.signature)throw Error('PING state proof mismatch');
let checked=1;
for(const outputProfile of ['car_hifi','headphones','speaker'])for(const mode of ['pure','adaptive','power'])for(let mask=0;mask<16;mask++){const st={...state,outputProfile,mode,bassEnabled:Boolean(mask&1),impactEnabled:Boolean(mask&2),clarityEnabled:Boolean(mask&4),spatialEnabled:Boolean(mask&8),intensity:(mask%5)/4,spaceMode:mask%3===2?'arena':mask%3===1?'live':'studio'};const rev=100+checked;p.port.send({type:'SET_STATE',revision:rev,state:st});const a=[...p.port.messages].reverse().find(m=>m.type==='STATE_APPLIED'&&m.revision===rev);if(!a)throw Error('missing route ACK '+rev);if(a.appliedState.mode!==st.mode||a.appliedState.outputProfile!==st.outputProfile||a.appliedState.bassEnabled!==st.bassEnabled||a.appliedState.impactEnabled!==st.impactEnabled||a.appliedState.clarityEnabled!==st.clarityEnabled||a.appliedState.spatialEnabled!==st.spatialEnabled)throw Error('route ACK mismatch '+rev);checked++;}
console.log(`V5.4 Worklet route: ${checked}/${checked} PASS`);console.log('ACK signature:',ack.signature.slice(0,80)+'...');
