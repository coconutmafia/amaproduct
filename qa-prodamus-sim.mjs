import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{autoRefreshToken:false,persistSession:false} })

// Replicate the server's sign + parse exactly (lib/billing/prodamus.ts).
function phpNormalize(node){ if(node&&typeof node==='object'&&!Array.isArray(node)){const k=Object.keys(node);const list=k.length>0&&k.every((x,i)=>x===String(i));if(list)return k.map(x=>phpNormalize(node[x]));const o={};for(const x of k)o[x]=phpNormalize(node[x]);return o}return node }
function sortDeepStringify(node){ if(Array.isArray(node))return node.map(sortDeepStringify); if(node&&typeof node==='object'){const o={};for(const x of Object.keys(node).sort())o[x]=sortDeepStringify(node[x]);return o} return node==null?'':String(node) }
function prodamusSign(data, secret){ const j=JSON.stringify(sortDeepStringify(phpNormalize(data))).replace(/\//g,'\\/'); return crypto.createHmac('sha256',secret).update(j,'utf8').digest('hex') }
function parseFormNested(body){ const p=new URLSearchParams(body);const root={};for(const [rk,v] of p){const h=rk.match(/^([^[]+)(.*)$/);if(!h)continue;const path=[h[1]];const re=/\[([^\]]*)\]/g;let m;while((m=re.exec(h[2]))!==null)path.push(m[1]);let n=root;for(let i=0;i<path.length;i++){const key=path[i]||String(Object.keys(n).length);if(i===path.length-1)n[key]=v;else{if(n[key]==null||typeof n[key]!=='object')n[key]={};n=n[key]}}}return root }

const SECRET = 'st1265po89'
const USER = '6b499e54-bc70-4b54-8a95-4cafcffd7888' // aya272satori (tester)
const ts = Date.now()
const fields = {
  order_id: `${USER}.pro.${ts}`, order_num: String(ts), payment_status: 'success',
  sum: '14900', currency: 'rub', customer_email: 'aya272satori@gmail.com',
  date: new Date().toISOString().slice(0,19), subscription: '2947004',
}
const body = new URLSearchParams(fields).toString()
const sign = prodamusSign(parseFormNested(body), SECRET)

const before = (await sb.from('profiles').select('subscription_tier,subscription_status').eq('id',USER).maybeSingle()).data
const res = await fetch('https://amaproduct.com/api/billing/prodamus/webhook', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded','Sign':sign}, body })
const txt = await res.text()
await new Promise(r=>setTimeout(r,1500))
const after = (await sb.from('profiles').select('subscription_tier,subscription_status,payment_provider,provider_subscription_id,current_period_end').eq('id',USER).maybeSingle()).data

console.log('WEBHOOK RESPONSE:', res.status, txt)
console.log('BEFORE:', JSON.stringify(before))
console.log('AFTER :', JSON.stringify(after))

// revert tester to trial (keep test data clean)
await sb.from('profiles').update({ subscription_tier:'trial', subscription_status:'trialing', payment_provider:null, provider_subscription_id:null, current_period_end:null }).eq('id',USER)
console.log('reverted aya → trial')
