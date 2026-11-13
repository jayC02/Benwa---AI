import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const require=createRequire('/opt/runner/package.json');
const {chromium}=require('playwright');
const target=process.argv[2];
if(!target||target.includes('..')||path.isAbsolute(target))throw new Error('Invalid browser artifact');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const server=http.createServer(async(req,res)=>{
  try{const file=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);if(file.split('/').some(v=>v.startsWith('.')||v==='..')||file.includes('\\'))throw new Error('Invalid path');const source=await fs.readFile(path.join('/project',file||target));res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'text/plain'});res.end(source)}catch{res.writeHead(404);res.end('Not found')}
});
await new Promise(resolve=>server.listen(8765,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:1280,height:800}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:8765'?route.continue():route.abort());
  const response=await page.goto(`http://127.0.0.1:8765/${target}`,{waitUntil:'networkidle',timeout:15000});
  if(response?.status()!==200)throw new Error('Artifact did not serve successfully');
  const screenshot=await page.screenshot();
  console.log(JSON.stringify({title:await page.title(),browserErrors:errors,screenshotHash:createHash('sha256').update(screenshot).digest('hex'),checks:'HTML load and browser exception check only; domain-specific interaction tests belong in project test files'}));
  if(errors.length)process.exitCode=1;
}finally{await browser?.close();server.close();}
