import { writeFile } from 'node:fs/promises';

export async function connect(port = 9228, targetId = process.env.CDP_TARGET) {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find(p=>targetId ? p.id===targetId : p.type==='page' && !p.url.startsWith('chrome:'));
  if(!page) throw new Error('No Chrome page available');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let next=0; const pending=new Map(); const events=[];
  socket.addEventListener('message',event=>{
    const data=JSON.parse(event.data);
    if(data.id){const p=pending.get(data.id);pending.delete(data.id);data.error?p?.reject(new Error(JSON.stringify(data.error))):p?.resolve(data.result);}
    else events.push(data);
  });
  // A dead tab must fail the run loudly instead of leaving every request unresolved.
  socket.addEventListener('close',()=>{
    for(const [,p]of pending) p.reject(new Error('CDP socket closed'));
    pending.clear();
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until=async(expression,timeout=15000)=>{
    const start=Date.now();
    while(Date.now()-start<timeout){const value=await evaluate(expression);if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}
    throw new Error(`Timed out waiting for ${expression}`);
  };
  const click=async selector=>{
    const pos=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Element missing');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pos});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pos});
  };
  const key=async(code,down=true)=>{
    const keys={ArrowLeft:['ArrowLeft',37],ArrowRight:['ArrowRight',39],ArrowDown:['ArrowDown',40],Space:[' ',32],Escape:['Escape',27],ShiftLeft:['Shift',16],KeyA:['a',65],KeyD:['d',68],KeyS:['s',83]};
    await send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',key:keys[code][0],code,windowsVirtualKeyCode:keys[code][1],nativeVirtualKeyCode:keys[code][1]});
  };
  const screenshot=async path=>{const result=await send('Page.captureScreenshot',{format:'png'});await writeFile(path,Buffer.from(result.data,'base64'));await send('Page.bringToFront');};
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Page.bringToFront');
  return {send,evaluate,until,click,key,screenshot,events,close:()=>socket.close()};
}
