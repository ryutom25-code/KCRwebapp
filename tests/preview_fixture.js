// Used only by preview_server.py --fixtures. Never loaded in normal operation.
const fixtureNow='2026-11-17T03:00:00Z';
const fixtureData={
 profiles:[{id:'demo',name:'キャンパス 太郎',school_name:'高田高等学校',grade:'3',points:250}],
 products:[{id:'p1',name:'オリジナルボールペン',points:50,image_url:'/icons/campus.svg'},{id:'p2',name:'キャンパストートバッグ',points:150,image_url:'/icons/campus.svg'},{id:'p3',name:'ロゴ入りノート',points:100,image_url:'/icons/campus.svg'}],
 events:[{id:'e1',title:'秋のオープンキャンパス',event_date:'2026-11-22',is_new:true,updated_at:fixtureNow},{id:'e2',title:'学科体験・キャンパスツアー',event_date:'2026-12-06',is_new:false,updated_at:fixtureNow}],
 exchange_logs_view:[['ネコ',-50],['fesfes',-50],['ネコ',-150],['ネコ',-150],['fesfes',-50],['小',-100]].map(([name,points],i)=>({id:i+1,user_id:'demo',created_at:fixtureNow,product_name:'景品交換: '+name,user_name:'キャンパス 太郎',school_name:'高田高等学校',grade:'3',points})),
 point_history:[{id:1,user_id:'demo',title:'理学療法学科 来校ポイント',points:50,category:'welcome',created_at:fixtureNow},{id:2,user_id:'demo',title:'景品交換: ネコ',points:-50,category:'exchange',created_at:fixtureNow}],
 checkins:[{id:'c1',user_id:'demo',booth_id:'PT',created_at:fixtureNow}],quiz_sets:[{id:'s1',department:'PT',title:'はじめての理学療法クイズ',created_at:fixtureNow}],
 quizzes:[{id:'q1',set_id:'s1',question:'理学療法士がサポートするのは、どんなこと？',options:['身体の動きや機能の回復','建物の設計','食品の生産','道路の工事'],points:10,correct_index:0}],quiz_answers:[],qr_codes:[]
};
const fixtureQuery=table=>{
 let filters=[],rangeStart=0,rangeEnd=Infinity,single=false,count=false,head=false,action=null,payload=null,sort=[];
 const q={select(columns,opts={}){count=opts.count;head=opts.head;return q;},eq(k,v){filters.push(row=>String(row[k])===String(v));return q;},in(k,v){filters.push(row=>v.includes(row[k]));return q;},gt(k,v){filters.push(row=>row[k]>v);return q;},neq(k,v){filters.push(row=>row[k]!==v);return q;},gte(){return q;},or(){return q;},order(k,opts={}){sort.push([k,opts.ascending!==false]);return q;},range(a,b){rangeStart=a;rangeEnd=b;return q;},single(){single=true;return q;},maybeSingle(){single=true;return q;},insert(p){action='insert';payload=p;return q;},upsert(p){action='insert';payload=p;return q;},update(p){action='update';payload=p;return q;},delete(){action='delete';return q;},then(resolve,reject){
  return Promise.resolve().then(()=>{
   const base=fixtureData[table]||[];
   if(action==='insert')for(const item of(Array.isArray(payload)?payload:[payload]))base.push({...item,id:item.id||crypto.randomUUID(),created_at:fixtureNow,updated_at:fixtureNow});
   if(action==='update')base.filter(row=>filters.every(f=>f(row))).forEach(row=>Object.assign(row,payload));
   if(action==='delete')fixtureData[table]=base.filter(row=>!filters.every(f=>f(row)));
   let rows=(fixtureData[table]||[]).filter(row=>filters.every(f=>f(row)));
   for(const [key,asc]of [...sort].reverse())rows=[...rows].sort((a,b)=>String(a[key]||'').localeCompare(String(b[key]||''))*(asc?1:-1));
   const total=rows.length;rows=rows.slice(rangeStart,rangeEnd+1);
   return {data:head?null:single?rows[0]||null:rows,count:count?total:null,error:null};
  }).then(resolve,reject);
 }};return q;
};
window.supabaseClient={from:fixtureQuery,auth:{getUser:async()=>({data:{user:{id:'demo'}}}),signInWithPassword:async()=>({data:{user:{id:'demo'}}}),signUp:async()=>({data:{session:true}}),signOut:async()=>({})},rpc:async(name,args)=>({data:name==='get_quiz_management'?fixtureData.quiz_sets.map(set=>({...set,quizzes:fixtureData.quizzes.filter(q=>q.set_id===set.id)})):name==='answer_quiz'?{isCorrect:args.p_selected_index===0,earnedPoints:10}:name==='exchange_product'?{newPoints:200,productName:'景品'}:{},error:null})};
const supabaseInitPromise=Promise.resolve();
window.Html5QrcodeScanner=class{constructor(id){this.id=id;}render(){document.getElementById(this.id).innerHTML='<div class="empty">カメラプレビュー<br><button type="button">カメラを許可</button></div>';}};
window.Html5Qrcode=class{start(){return Promise.resolve();}stop(){return Promise.resolve();}clear(){}};
window.QRCode=class{static CorrectLevel={H:1};constructor(el){el.innerHTML='<svg viewBox="0 0 100 100" width="220" height="220" aria-label="QRプレビュー"><path d="M5 5h30v30H5zM65 5h30v30H65zM5 65h30v30H5zM45 45h20v20H45zM75 75h20v20H75z" fill="#182a46"/></svg>';}};
