import {test,expect} from '@playwright/test';
import {mockDirectStream} from './helpers/direct-stream';
test('Vercel-compatible scoped WebSocket keeps live words, PCM, pause, reconnect and stop reliable',async({page,context})=>{
 await mockDirectStream(page);await context.grantPermissions(['microphone']);
 await page.route('**/api/transcribe',route=>route.fulfill({json:{transcript:'Today we need to finish the landing page. Besok kita deploy.'}}));
 await page.goto('/');await page.getByRole('button',{name:'Start recording',exact:true}).click();
 await page.waitForFunction(()=>(window as unknown as {testDirect:{connected:boolean;nonzero:boolean}}).testDirect.connected&&(window as unknown as {testDirect:{nonzero:boolean}}).testDirect.nonzero);
 const transcript=page.getByRole('region',{name:'Live transcript',exact:true});
 for(const text of ['Today','Today we need','Today we need to finish the landing page']){
  await page.evaluate(text=>(window as unknown as {testDirect:{emit:(type:'partial'|'final',text:string)=>void}}).testDirect.emit('partial',text),text);
  await expect(transcript).toContainText(text);await expect(page.getByRole('button',{name:'Stop recording',exact:true})).toBeVisible();
 }
 await page.evaluate(()=>(window as unknown as {testDirect:{emit:(type:'partial'|'final',text:string)=>void}}).testDirect.emit('final','Today we need to finish the landing page.'));
 await page.getByRole('button',{name:'Pause recording',exact:true}).click();
 const frames=await page.evaluate(()=>(window as unknown as {testDirect:{frames:number}}).testDirect.frames);await page.waitForTimeout(400);
 expect(await page.evaluate(()=>(window as unknown as {testDirect:{frames:number}}).testDirect.frames)).toBe(frames);
 await page.getByRole('button',{name:'Resume recording',exact:true}).click();await page.evaluate(()=>(window as unknown as {testDirect:{disconnect:()=>void}}).testDirect.disconnect());
 await page.waitForFunction(()=>(window as unknown as {testDirect:{connections:number;connected:boolean}}).testDirect.connections===2&&(window as unknown as {testDirect:{connected:boolean}}).testDirect.connected);
 await expect(transcript).toContainText('Today we need to finish the landing page.');
 await page.evaluate(()=>(window as unknown as {testDirect:{emit:(type:'partial'|'final',text:string)=>void}}).testDirect.emit('partial','Besok kita deploy'));
 await expect(transcript).toContainText('Besok kita deploy');await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Meeting transcript',exact:true})).toHaveValue('Today we need to finish the landing page. Besok kita deploy.');
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {testDirect:{connected:boolean}}).testDirect.connected)).toBe(false);
});
