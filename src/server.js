import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { openDatabase } from './db.js';
import { token, hash, hashPassword, verifyPassword, cleanBody, textOnly, localMedia, detectMedia } from './security.js';
import { page, homePage, coursesPage, galleryPage, accessPage, contactPage, loginPage, parentsPage, blogPage, postPage, adminPage, invitePage, messagePage, categories } from './views.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = () => new Date().toISOString();
const emailValid = value => typeof value==='string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const fail = (status, message) => Object.assign(new Error(message), { status });

export function createApp(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || path.join(root,'data'));
  const db = openDatabase(dataDir);
  const app = express();
  const production = (options.production ?? process.env.NODE_ENV==='production');
  const publicUrl = options.publicUrl || process.env.PUBLIC_URL || 'http://localhost:3000';
  const publicOrigin = new URL(publicUrl).origin;
  if (production && !publicOrigin.startsWith('https://')) throw new Error('PUBLIC_URL must use HTTPS in production.');
  app.disable('x-powered-by');
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 0));
  app.use((req,res,next)=>{
    res.set({
      'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'same-origin',
      'X-Frame-Options':'DENY', 'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://static.wixstatic.com; font-src 'self'; media-src 'self' https://video.wixstatic.com; connect-src 'self'; frame-src https://www.google.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    });
    if(production) res.set('Strict-Transport-Security','max-age=31536000');
    next();
  });
  app.use(express.static(path.join(root,'public'), { dotfiles:'deny', index:false, maxAge:production?'1h':0 }));
  app.use(express.json({ limit:'1mb' }));
  app.use(express.urlencoded({ extended:false, limit:'1mb' }));

  const setCookie = (res, raw, maxAge) => res.cookie('sw_session',raw,{httpOnly:true,sameSite:'lax',secure:production,path:'/',maxAge});
  function newSession(req,res,userId=null) {
    if(req.session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.session.token_hash);
    const raw=token(), csrf=token(), maxAge=userId?12*60*60*1000:2*60*60*1000;
    req.session={token_hash:hash(raw),csrf,user_id:userId,expires_at:Date.now()+maxAge};
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(req.session.token_hash,userId,csrf,req.session.expires_at);
    setCookie(res,raw,maxAge);
    return req.session;
  }
  app.use((req,res,next)=>{
    res.set('Cache-Control','private, no-store');
    const raw=(req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('sw_session='))?.slice(11);
    if(raw && /^[a-f0-9]{64}$/.test(raw)) {
      req.session=db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(raw),Date.now());
      if(req.session?.user_id) req.user=db.prepare('SELECT id,email,name,role FROM users WHERE id=? AND active=1').get(req.session.user_id);
      if(req.session?.user_id && !req.user) {db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.session.token_hash);req.session=null;}
    }
    next();
  });
  function ensureSession(req,res) { return req.session || newSession(req,res); }
  function csrf(req,res,next) {
    const supplied=req.get('X-CSRF-Token') || req.body?._csrf;
    const origin=req.get('Origin');
    if(origin && origin!==publicOrigin && !(options.allowTestOrigin && origin===options.allowTestOrigin)) return next(fail(403,'ページを再読み込みして、もう一度お試しください。'));
    if(!req.session || typeof supplied!=='string' || supplied!==req.session.csrf) return next(fail(403,'ページを再読み込みして、もう一度お試しください。'));
    next();
  }
  function requireAdmin(req,res,next) { if(req.user?.role!=='admin') return next(fail(403,'管理者のログインが必要です。')); next(); }
  function rateLimit(req,prefix,limit,windowMs,extra='') {
    const key=hash(`${prefix}:${req.ip}:${extra}`), time=Date.now();
    db.prepare('DELETE FROM rate_limits WHERE reset_at<?').run(time);
    db.prepare('DELETE FROM sessions WHERE expires_at<?').run(time);
    db.prepare('INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,time+windowMs);
    if(db.prepare('SELECT count FROM rate_limits WHERE key=?').get(key).count>limit) throw fail(429,'試行回数が多すぎます。しばらく待ってからお試しください。');
  }
  const visiblePost = (post,user) => !!post && (user?.role==='admin' || (post.status==='published' && (post.visibility==='public' || !!user)));
  const categoryName = slug => slug==='お知らせ'?'notice':slug;
  const publishedPosts = (user,category='',query='') => {
    let sql="SELECT * FROM posts WHERE status='published'"; const args=[];
    if(!user) sql+=" AND visibility='public'";
    if(category){sql+=' AND category=?';args.push(category);}
    if(query){sql+=" AND (title LIKE ? ESCAPE '\\' OR excerpt LIKE ? ESCAPE '\\')";const q='%'+query.replace(/[\\%_]/g,'\\$&')+'%';args.push(q,q);}
    return db.prepare(sql+' ORDER BY published_at DESC,created_at DESC').all(...args);
  };
  const render = (req,res,title,body,route='',noindex=false) => res.send(page({title,body,route,user:req.user,noindex}));
  const login = (req,res,nextUrl='/parents') => {const session=ensureSession(req,res);render(req,res,'ログイン',loginPage(session.csrf,nextUrl),'/login',true);};

  app.get('/healthz',(req,res)=>res.json({ok:true}));
  app.get('/',(req,res)=>render(req,res,'こども英語 SMALL WORLD | 府中市・分倍河原・府中本町',homePage(publishedPosts(null,'notice').filter(p=>p.featured)),'/'));
  app.get('/classes',(req,res)=>render(req,res,'Course & Price',coursesPage(),'/classes'));
  app.get('/gallery',(req,res)=>render(req,res,'Gallery',galleryPage(),'/gallery'));
  app.get('/access',(req,res)=>render(req,res,'Access',accessPage(),'/access'));
  app.get('/contact',(req,res)=>{const s=ensureSession(req,res);render(req,res,'Contact',contactPage(s.csrf),'/contact');});
  app.get('/login',(req,res)=>login(req,res,req.query.next==='/admin'?'/admin':'/parents'));
  app.get('/parents',(req,res)=>{
    if(!req.user) return login(req,res,'/parents');
    const s=ensureSession(req,res);render(req,res,'Parents',parentsPage(req.user,publishedPosts(req.user).slice(0,6),s.csrf),'/parents',true);
  });
  const blogHandler=(req,res)=>{
    if(!req.user) return login(req,res,'/blog');
    const category=categoryName(req.params.category||'');
    if(category && !categories[category]) return render404(req,res);
    const query=String(req.query.q||'').slice(0,100);
    const posts=publishedPosts(req.user,category,query);
    const pageNumber=Math.max(1,parseInt(req.query.page)||1), totalPages=Math.max(1,Math.ceil(posts.length/9));
    render(req,res,categories[category]||'News & Reports',blogPage(posts.slice((pageNumber-1)*9,pageNumber*9),category,query,pageNumber,totalPages),'/parents',true);
  };
  app.get('/blog',blogHandler);
  app.get('/blog/categories/:category',blogHandler);
  app.get('/post/:slug',(req,res)=>{
    const post=db.prepare('SELECT * FROM posts WHERE slug=?').get(req.params.slug);
    if(!visiblePost(post,req.user)) {
      if(post?.status==='published' && post.visibility==='members' && !req.user) return login(req,res,'/post/'+encodeURIComponent(post.slug));
      return render404(req,res);
    }
    render(req,res,post.title,postPage(post),'/parents',post.visibility==='members'||post.status!=='published');
  });
  app.get('/admin',(req,res)=>{
    if(!req.user) return login(req,res,'/admin');
    if(req.user.role!=='admin') return res.status(403).send(page({title:'アクセスできません',body:messagePage('管理者専用です','保護者ページをご利用ください。','/parents'),noindex:true,user:req.user}));
    res.send(adminPage(req.user,req.session.csrf));
  });
  app.get('/invite/:token',(req,res)=>{
    const invite=db.prepare('SELECT i.*,u.email,u.name FROM invitations i JOIN users u ON u.id=i.user_id WHERE token_hash=? AND expires_at>? AND u.active=1').get(hash(req.params.token),Date.now());
    if(!invite) return res.status(410).send(page({title:'招待リンク',body:messagePage('招待リンクの有効期限が切れています','教室に新しい招待リンクをご依頼ください。'),noindex:true}));
    const session=ensureSession(req,res);render(req,res,'保護者アカウントの登録',invitePage(invite,req.params.token,session.csrf),'/parents',true);
  });
  app.get('/api/session',(req,res)=>res.json({csrf:ensureSession(req,res).csrf,user:req.user||null}));
  app.post('/api/login',csrf,async(req,res)=>{
    rateLimit(req,'login',20,15*60*1000);
    const email=String(req.body.email||'').trim().toLowerCase();
    rateLimit(req,'login-account',8,15*60*1000,email);
    const user=db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
    if(!await verifyPassword(req.body.password,user?.password_hash)) throw fail(401,'メールアドレスまたはパスワードが正しくありません。');
    const s=newSession(req,res,user.id);
    const next=String(req.body.next||'');
    const safeNext=next==='/admin'&&user.role==='admin'?'/admin':next.startsWith('/post/')&&!/[\\\r\n]/.test(next)?next:next==='/blog'?'/blog':'/parents';
    res.json({ok:true,csrf:s.csrf,next:safeNext});
  });
  app.post('/api/logout',csrf,(req,res)=>{db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.session.token_hash);res.clearCookie('sw_session',{path:'/',secure:production,httpOnly:true,sameSite:'lax'});res.json({ok:true});});
  app.post('/api/accept-invite',csrf,async(req,res)=>{
    rateLimit(req,'invite',10,15*60*1000);
    const inviteHash=hash(String(req.body.token||''));
    const invite=db.prepare('SELECT i.* FROM invitations i JOIN users u ON u.id=i.user_id WHERE token_hash=? AND expires_at>? AND u.active=1').get(inviteHash,Date.now());
    if(!invite) throw fail(410,'招待リンクの有効期限が切れています。');
    const passwordHash=await hashPassword(req.body.password);
    // Re-check within a transaction after hashing: an invitation is strictly single use.
    db.exec('BEGIN IMMEDIATE');
    try {
      if(!db.prepare('DELETE FROM invitations WHERE token_hash=? AND expires_at>?').run(inviteHash,Date.now()).changes) throw fail(410,'この招待リンクは使用済みです。');
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash,invite.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(invite.user_id);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    newSession(req,res,invite.user_id);res.json({ok:true,next:'/parents'});
  });
  app.post('/api/contact',csrf,(req,res)=>{
    rateLimit(req,'contact',5,60*60*1000);
    if(req.body.website) return res.json({ok:true});
    const {name,email,subject='',message}=req.body;
    if(typeof name!=='string'||!name.trim()||name.length>100||!emailValid(email)||typeof subject!=='string'||subject.length>200||typeof message!=='string'||!message.trim()||message.length>10000) throw fail(400,'お名前、メールアドレス、メッセージをご確認ください。');
    db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,0,?)').run(randomUUID(),name.trim(),email.trim(),subject.trim(),message.trim(),now());
    res.json({ok:true});
  });

  app.use('/api/admin',requireAdmin);
  app.use('/api/admin',(req,res,next)=>['GET','HEAD'].includes(req.method)?next():csrf(req,res,next));
  app.get('/api/admin/posts',(req,res)=>res.json({posts:db.prepare('SELECT * FROM posts ORDER BY updated_at DESC').all()}));
  app.get('/api/admin/posts/:id',(req,res)=>{const post=db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);if(!post)throw fail(404,'記事が見つかりません。');res.json({post});});
  function validatePost(body,current=null) {
    const title=String(body.title||'').trim(), category=body.category;
    if(!title||title.length>200) throw fail(400,'タイトルは1〜200文字で入力してください。');
    if(!categories[category]) throw fail(400,'記事の種類を選択してください。');
    if(!['draft','published','archived'].includes(body.status)||!['members','public'].includes(body.visibility)) throw fail(400,'公開設定をご確認ください。');
    const content=cleanBody(body.body);
    if(content.length>500000) throw fail(400,'本文が長すぎます。');
    const slug=current?.slug || (String(body.slug||'').trim().toLowerCase() || title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,80)+'-'+randomUUID().slice(0,6));
    if(!/^[\p{L}\p{N}][\p{L}\p{N}-]{0,139}$/u.test(slug)) throw fail(400,'URLには文字・数字・ハイフンを使用してください。');
    const lessonDate=String(body.lesson_date||'');
    if(lessonDate && (!/^\d{4}-\d{2}-\d{2}$/.test(lessonDate)||!Number.isFinite(Date.parse(lessonDate)))) throw fail(400,'レッスン日をご確認ください。');
    const cover=localMedia(body.cover);
    if(cover.startsWith('/uploads/')) {const media=db.prepare('SELECT mime FROM media WHERE filename=?').get(cover.split('/').at(-1));if(!media?.mime.startsWith('image/'))throw fail(400,'カバーにはアップロード済みの画像を選択してください。');}
    return {slug,title,category,status:body.status,visibility:body.visibility,excerpt:String(body.excerpt||textOnly(content)).slice(0,400),body:content,cover,lesson_date:lessonDate,class_name:String(body.class_name||'').slice(0,100),featured:body.featured&&body.visibility==='public'&&category==='notice'?1:0,published_at:current?.published_at||(body.status==='published'?now():''),updated_at:now()};
  }
  app.post('/api/admin/preview',(req,res)=>{
    const post=validatePost({...req.body,status:'draft'});
    res.json({html:postPage(post)});
  });
  app.post('/api/admin/posts',(req,res)=>{
    const post=validatePost(req.body), id=randomUUID();
    db.prepare(`INSERT INTO posts(id,${Object.keys(post).join(',')},created_at) VALUES (${Array(Object.keys(post).length+2).fill('?').join(',')})`).run(id,...Object.values(post),now());
    res.status(201).json({post:db.prepare('SELECT * FROM posts WHERE id=?').get(id)});
  });
  app.put('/api/admin/posts/:id',(req,res)=>{
    const current=db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
    if(!current)throw fail(404,'記事が見つかりません。');
    if(Number(req.body.version)!==current.version)throw fail(409,'別の画面で更新されています。編集内容をコピーしてから、記事を開き直してください。');
    const post=validatePost(req.body,current);
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO revisions(post_id,snapshot,created_at) VALUES (?,?,?)').run(current.id,JSON.stringify(current),now());
      db.prepare(`UPDATE posts SET ${Object.keys(post).map(k=>k+'=?').join(',')},version=version+1 WHERE id=?`).run(...Object.values(post),current.id);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    res.json({post:db.prepare('SELECT * FROM posts WHERE id=?').get(current.id)});
  });
  app.get('/api/admin/posts/:id/revisions',(req,res)=>res.json({revisions:db.prepare('SELECT id,created_at FROM revisions WHERE post_id=? ORDER BY id DESC LIMIT 30').all(req.params.id)}));
  app.post('/api/admin/posts/:id/restore/:revision',(req,res)=>{
    const row=db.prepare('SELECT snapshot FROM revisions WHERE id=? AND post_id=?').get(req.params.revision,req.params.id);
    const current=db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
    if(!row||!current)throw fail(404,'履歴が見つかりません。');
    if(Number(req.body.version)!==current.version)throw fail(409,'記事が更新されています。開き直してください。');
    const old=JSON.parse(row.snapshot), restored=validatePost({...old,status:'draft'},current);
    db.exec('BEGIN');
    try {db.prepare('INSERT INTO revisions(post_id,snapshot,created_at) VALUES (?,?,?)').run(current.id,JSON.stringify(current),now());db.prepare(`UPDATE posts SET ${Object.keys(restored).map(k=>k+'=?').join(',')},version=version+1 WHERE id=?`).run(...Object.values(restored),current.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    res.json({post:db.prepare('SELECT * FROM posts WHERE id=?').get(current.id)});
  });
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:25*1024*1024,files:1,fields:2,parts:3}});
  app.post('/api/admin/media',upload.single('file'),(req,res)=>{
    if(!req.file)throw fail(400,'ファイルを選択してください。');
    const kind=detectMedia(req.file.buffer);
    if(!kind)throw fail(400,'JPG・PNG・GIF・WebP画像、MP3・M4A・OGG・WAV音声、MP4動画を選択してください。');
    const id=randomUUID(), filename=id+kind[1];
    writeFileSync(path.join(dataDir,'uploads',filename),req.file.buffer,{mode:0o600});
    db.prepare('INSERT INTO media VALUES (?,?,?,?,?,?)').run(id,filename,req.file.originalname.slice(0,200),kind[0],req.file.size,now());
    res.status(201).json({url:'/uploads/'+filename,mime:kind[0],name:req.file.originalname});
  });
  app.get('/api/admin/media',(req,res)=>res.json({media:db.prepare('SELECT *,\'/uploads/\'||filename AS url FROM media ORDER BY created_at DESC LIMIT 200').all()}));
  app.get('/uploads/:filename',(req,res)=>{
    const media=db.prepare('SELECT * FROM media WHERE filename=?').get(req.params.filename);
    if(!media)return res.status(404).end();
    const url='/uploads/'+media.filename;
    if(req.user?.role!=='admin') {
      const posts=publishedPosts(req.user);
      if(!posts.some(p=>p.cover===url || p.body.includes(`src="${url}"`)))return res.status(404).end();
    }
    res.type(media.mime).sendFile(path.join(dataDir,'uploads',media.filename),{headers:{'Cache-Control':'private, no-store'}});
  });
  app.get('/api/admin/messages',(req,res)=>res.json({messages:db.prepare('SELECT * FROM messages ORDER BY created_at DESC').all()}));
  app.put('/api/admin/messages/:id',(req,res)=>{db.prepare('UPDATE messages SET is_read=? WHERE id=?').run(req.body.is_read?1:0,req.params.id);res.json({ok:true});});
  app.get('/api/admin/members',(req,res)=>res.json({members:db.prepare('SELECT id,email,name,role,active,password_hash IS NOT NULL AS registered,created_at FROM users ORDER BY created_at DESC').all()}));
  app.post('/api/admin/members',(req,res)=>{
    const email=String(req.body.email||'').trim().toLowerCase(), name=String(req.body.name||'').trim();
    if(!emailValid(email)||!name||name.length>100)throw fail(400,'お名前とメールアドレスをご確認ください。');
    if(db.prepare('SELECT 1 FROM users WHERE email=?').get(email))throw fail(409,'このメールアドレスは登録済みです。');
    const id=randomUUID(), raw=token();
    db.prepare('INSERT INTO users VALUES (?,?,?,NULL,\'parent\',1,?)').run(id,email,name,now());
    db.prepare('INSERT INTO invitations VALUES (?,?,?)').run(hash(raw),id,Date.now()+7*24*60*60*1000);
    res.status(201).json({url:publicOrigin+'/invite/'+raw});
  });
  app.post('/api/admin/members/:id/invite',(req,res)=>{
    const user=db.prepare("SELECT * FROM users WHERE id=? AND role='parent' AND active=1").get(req.params.id);
    if(!user)throw fail(404,'有効な保護者アカウントが見つかりません。');
    const raw=token();db.prepare('DELETE FROM invitations WHERE user_id=?').run(user.id);db.prepare('INSERT INTO invitations VALUES (?,?,?)').run(hash(raw),user.id,Date.now()+7*24*60*60*1000);res.json({url:publicOrigin+'/invite/'+raw});
  });
  app.put('/api/admin/members/:id',(req,res)=>{
    const user=db.prepare("SELECT * FROM users WHERE id=? AND role='parent'").get(req.params.id);
    if(!user)throw fail(400,'このアカウントは変更できません。');
    db.prepare('UPDATE users SET active=? WHERE id=?').run(req.body.active?1:0,user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);db.prepare('DELETE FROM invitations WHERE user_id=?').run(user.id);res.json({ok:true});
  });
  app.get('/api/admin/export',(req,res)=>{res.attachment('small-world-posts.json').json({format:'small-world-v1',exportedAt:now(),posts:db.prepare('SELECT * FROM posts').all()});});
  app.get('/robots.txt',(req,res)=>res.type('text').send('User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /parents\nDisallow: /blog\nDisallow: /invite/\nDisallow: /uploads/\nSitemap: '+publicOrigin+'/sitemap.xml\n'));
  app.get('/sitemap.xml',(req,res)=>{
    const urls=['/','/classes','/gallery','/access','/contact',...publishedPosts(null).map(p=>'/post/'+encodeURIComponent(p.slug))];
    res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(url=>'<url><loc>'+publicOrigin+url+'</loc></url>').join('')+'</urlset>');
  });
  function render404(req,res) {res.status(404);render(req,res,'ページが見つかりません',messagePage('ページが見つかりません','URLをご確認いただくか、ホームにお戻りください。'),'',true);}
  app.use((req,res)=>req.path.startsWith('/api/')?res.status(404).json({error:'見つかりません。'}):render404(req,res));
  app.use((err,req,res,next)=>{
    if(res.headersSent)return next(err);
    let status=err.status||500, message=err.message;
    if(err.code==='LIMIT_FILE_SIZE'){status=413;message='ファイルは25MB以下にしてください。';}
    else if(err instanceof multer.MulterError){status=400;message='ファイルを1つ選択してください。';}
    else if(err.code?.startsWith('ERR_SQLITE') && /UNIQUE/.test(err.message)){status=409;message='このURLまたはメールアドレスは使用済みです。';}
    if(status===500){console.error('Request failed:',req.method,req.path,err.message);message='処理に失敗しました。もう一度お試しください。';}
    if(req.path.startsWith('/api/'))res.status(status).json({error:message});
    else res.status(status).send(page({title:'エラー',body:messagePage('処理に失敗しました',message),noindex:true}));
  });
  return {app,db,dataDir};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {app,db}=createApp();
  const server=app.listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0',()=>console.log(`SMALL WORLD is listening on port ${process.env.PORT||3000}`));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>{db.close();process.exit(0);});});
}
