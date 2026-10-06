import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';

const dataDir=mkdtempSync(path.join(tmpdir(),'smallworld-test-'));
const adminPassword=randomBytes(24).toString('base64url');
let db,server,origin,admin,guest,parent,post,privateMedia,publicMedia;
class Client{
  cookie='';csrf='';
  async request(url,method='GET',body,withCsrf=true,headers={}){
    const response=await fetch(origin+url,{method,headers:{...(this.cookie?{Cookie:this.cookie}:{}),...(withCsrf&&this.csrf?{'X-CSRF-Token':this.csrf}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,redirect:'manual'});
    const cookie=response.headers.get('set-cookie');if(cookie)this.cookie=cookie.split(';')[0];
    const data=response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text();
    return {status:response.status,data,headers:response.headers};
  }
  async session(){const r=await this.request('/api/session');this.csrf=r.data.csrf;return this;}
  async login(email,password){await this.session();const r=await this.request('/api/login','POST',{email,password});if(r.data.csrf)this.csrf=r.data.csrf;return r;}
}
before(async()=>{
  const instance=createApp({dataDir,publicUrl:'http://localhost:3000'});db=instance.db;
  db.prepare('INSERT INTO users VALUES (?,?,?,?,\'admin\',1,?)').run(randomUUID(),'admin@example.test','Test Admin',await hashPassword(adminPassword),new Date().toISOString());
  await new Promise(resolve=>{server=instance.app.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
  admin=new Client();guest=await new Client().session();assert.equal((await admin.login('admin@example.test',adminPassword)).status,200);
});
after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();rmSync(dataDir,{recursive:true,force:true});});

test('the original public pages, content, local images and member gates are present',async()=>{
  for(const [url,text] of [['/','About Us'],['/classes','¥9,900'],['/gallery','Kids love to study'],['/access','東京都府中市本町2-12-17'],['/contact','Contact'],['/parents','保護者ログイン'],['/blog','保護者ログイン'],['/blog/categories/word-rhythm','保護者ログイン']]){
    const r=await guest.request(url);assert.equal(r.status,200,url);assert.ok(r.data.includes(text),url);
  }
  assert.equal((await guest.request('/missing')).status,404);
  const home=(await guest.request('/')).data;
  const assets=[...home.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(m=>m[1]);
  for(const asset of new Set(assets))assert.equal((await guest.request(asset)).status,200,asset);
  assert.equal((await guest.request('/api/admin/posts')).status,403);
  assert.ok((await guest.request('/admin')).data.includes('管理者ログイン'));
});

test('sessions rotate on login and require CSRF plus a matching browser origin',async()=>{
  const client=await new Client().session(), anonymous=client.cookie;
  const login=await client.request('/api/login','POST',{email:'admin@example.test',password:adminPassword});
  assert.equal(login.status,200);assert.notEqual(client.cookie,anonymous);
  assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Lax/);
  const denied=await client.request('/api/admin/posts','POST',{title:'bad'},false);assert.equal(denied.status,403);
  client.csrf=login.data.csrf;
  assert.equal((await client.request('/api/admin/posts','POST',{},true,{Origin:'https://attacker.example'})).status,403);
  assert.equal((await client.request('/api/logout','POST')).status,200);
  assert.equal((await client.request('/api/admin/posts')).status,403);
});

test('all three blog categories can be drafted, published, searched and edited',async()=>{
  for(const category of ['lesson-report','notice','word-rhythm']){
    const created=await admin.request('/api/admin/posts','POST',{title:'Test '+category,category,status:'draft',visibility:'members',body:'<h2>Today</h2><p>We learned together.</p>',lesson_date:'2026-09-16',class_name:'Monday'});
    assert.equal(created.status,201);const p=created.data.post;
    assert.equal((await guest.request('/post/'+p.slug)).status,404);
    const publish=await admin.request('/api/admin/posts/'+p.id,'PUT',{...p,status:'published'});assert.equal(publish.status,200);
    const gate=await guest.request('/post/'+p.slug);assert.ok(gate.data.includes('保護者ログイン'));assert.ok(!gate.data.includes('We learned together.'));
    if(category==='lesson-report')post=publish.data.post;
  }
  const feed=await admin.request('/blog/categories/lesson-report?q=Test');assert.ok(feed.data.includes('Test lesson-report'));assert.ok(!feed.data.includes('Test word-rhythm'));
});

test('sanitization removes scripts, event handlers, remote tracking images and unsafe links',async()=>{
  const attack='<script>evil()</script><img src="https://evil.test/pixel" onerror="evil()"><a href="javascript:evil()">click</a><audio src="https://evil.test/audio" onplay="evil()"></audio><p><strong>Keep this</strong></p>';
  const saved=await admin.request('/api/admin/posts/'+post.id,'PUT',{...post,body:attack});assert.equal(saved.status,200);post=saved.data.post;
  assert.ok(!post.body.includes('script'));assert.ok(!post.body.includes('onerror'));assert.ok(!post.body.includes('javascript:'));assert.ok(!post.body.includes('evil.test'));assert.ok(post.body.includes('<strong>Keep this</strong>'));
});

test('migration media is limited to the original Wix image and video CDNs',async()=>{
  const sourceImage='https://static.wixstatic.com/media/f00f2c_example.jpg';
  const sourceVideo='https://video.wixstatic.com/video/f00f2c_example/1080p/mp4/file.mp4';
  const saved=await admin.request('/api/admin/posts/'+post.id,'PUT',{...post,cover:sourceImage,body:`<img src="${sourceImage}" alt="Lesson"><video src="${sourceVideo}"></video><img src="https://evil.test/pixel.jpg">`});
  assert.equal(saved.status,200);post=saved.data.post;
  assert.equal(post.cover,sourceImage);assert.ok(post.body.includes(sourceImage));assert.ok(post.body.includes(sourceVideo));assert.ok(!post.body.includes('evil.test'));
  const page=await admin.request('/post/'+post.slug);assert.match(page.headers.get('content-security-policy'),/static\.wixstatic\.com/);assert.match(page.headers.get('content-security-policy'),/video\.wixstatic\.com/);
});

test('stale edits are rejected, archive is reversible, and history restores as a draft',async()=>{
  const old={...post};let changed=await admin.request('/api/admin/posts/'+post.id,'PUT',{...post,title:'Edited lesson'});assert.equal(changed.status,200);post=changed.data.post;
  assert.equal((await admin.request('/api/admin/posts/'+post.id,'PUT',{...old,title:'Stale edit'})).status,409);
  changed=await admin.request('/api/admin/posts/'+post.id,'PUT',{...post,status:'archived'});post=changed.data.post;assert.equal(post.status,'archived');
  assert.equal((await guest.request('/post/'+post.slug)).status,404);
  const revisions=(await admin.request('/api/admin/posts/'+post.id+'/revisions')).data.revisions;assert.ok(revisions.length>=2);
  changed=await admin.request(`/api/admin/posts/${post.id}/restore/${revisions[0].id}`,'POST',{version:post.version});assert.equal(changed.status,200);post=changed.data.post;assert.equal(post.status,'draft');
});

test('preview sanitizes without saving or publishing an article',async()=>{
  const before=db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
  const preview=await admin.request('/api/admin/preview','POST',{title:'Preview only',category:'word-rhythm',visibility:'members',body:'<p>Listen and repeat.</p><script>alert(1)</script>'});
  assert.equal(preview.status,200);assert.ok(preview.data.html.includes('Listen and repeat.'));assert.ok(!preview.data.html.includes('<script>'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posts').get().n,before);
});

test('uploads verify file content, require admin, and protect unpublished and member media',async()=>{
  const file=readFileSync(new URL('../public/assets/f00f2c_949466f73c8e46fc9ece2b2065c8d0ce~mv2.png',import.meta.url));
  const upload=async(client,bytes,name,type)=>{const form=new FormData();form.append('file',new Blob([bytes],{type}),name);return client.request('/api/admin/media','POST',form);};
  assert.equal((await upload(guest,file,'photo.png','image/png')).status,403);
  assert.equal((await upload(admin,'<script>evil()</script>','fake.png','image/png')).status,400);
  const uploaded=await upload(admin,file,'photo.png','image/png');assert.equal(uploaded.status,201);privateMedia=uploaded.data.url;
  assert.equal((await guest.request(privateMedia)).status,404);assert.equal((await admin.request(privateMedia)).status,200);
  let saved=await admin.request('/api/admin/posts/'+post.id,'PUT',{...post,status:'published',cover:privateMedia,body:`<p>Members only</p><img src="${privateMedia}" alt="Lesson">`});post=saved.data.post;
  assert.equal((await guest.request(privateMedia)).status,404);
  const pub=await upload(admin,file,'public.png','image/png');publicMedia=pub.data.url;
  const published=await admin.request('/api/admin/posts','POST',{title:'Public notice',category:'notice',status:'published',visibility:'public',featured:true,cover:publicMedia,body:'<p>Open day</p>'});assert.equal(published.status,201);
  assert.equal((await guest.request(publicMedia)).status,200);assert.ok((await guest.request('/')).data.includes('Public notice'));
});

test('parent invitations are single use; parents can read protected posts and media but cannot administer',async()=>{
  const invite=await admin.request('/api/admin/members','POST',{name:'Test Parent',email:'parent@example.test'});assert.equal(invite.status,201);
  const inviteToken=invite.data.url.split('/').at(-1),password=randomBytes(18).toString('base64url');
  parent=await new Client().session();
  const accept=await parent.request('/api/accept-invite','POST',{token:inviteToken,password});assert.equal(accept.status,200);await parent.session();
  const repeated=await guest.request('/api/accept-invite','POST',{token:inviteToken,password});assert.equal(repeated.status,410);
  assert.ok((await parent.request('/post/'+post.slug)).data.includes('Members only'));
  assert.equal((await parent.request(privateMedia)).status,200);
  assert.equal((await parent.request('/api/admin/posts')).status,403);assert.equal((await parent.request('/api/admin/messages')).status,403);assert.equal((await parent.request('/admin')).status,403);
  assert.ok((await parent.request('/parents')).data.includes('Test Parent'));
});

test('deactivating a parent immediately revokes existing sessions and protected media access',async()=>{
  const id=db.prepare('SELECT id FROM users WHERE email=?').get('parent@example.test').id;
  assert.equal((await admin.request('/api/admin/members/'+id,'PUT',{active:false})).status,200);
  assert.ok((await parent.request('/parents')).data.includes('保護者ログイン'));
  assert.equal((await parent.request(privateMedia)).status,404);
});

test('contact submissions reach the protected admin inbox and remain escaped',async()=>{
  const submission=await guest.request('/api/contact','POST',{name:'<img src=x onerror=evil()>',email:'visitor@example.test',subject:'A lesson enquiry',message:'Please tell me about lessons.'});assert.equal(submission.status,200);
  const inbox=await admin.request('/api/admin/messages');assert.equal(inbox.status,200);const message=inbox.data.messages[0];assert.equal(message.subject,'A lesson enquiry');assert.equal(message.is_read,0);
  assert.equal((await admin.request('/api/admin/messages/'+message.id,'PUT',{is_read:true})).status,200);
  assert.equal((await guest.request('/api/admin/messages')).status,403);
});

test('the sitemap never reveals protected or draft posts, and export requires admin',async()=>{
  const sitemap=(await guest.request('/sitemap.xml')).data;assert.ok(!sitemap.includes(post.slug));assert.ok(sitemap.includes('/classes'));
  assert.equal((await guest.request('/api/admin/export')).status,403);
  const exported=await admin.request('/api/admin/export');assert.equal(exported.status,200);assert.equal(exported.data.format,'small-world-v1');assert.ok(exported.data.posts.length>=5);
  assert.equal((await guest.request('/.env')).status,404);assert.equal((await guest.request('/data/smallworld.sqlite')).status,404);
});

test('the database and posts survive closing and reopening the application',()=>{
  const second=createApp({dataDir});const stored=second.db.prepare('SELECT title FROM posts WHERE id=?').get(post.id);assert.equal(stored.title,post.title);second.db.close();
});
