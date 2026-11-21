'use client';
import {useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';
export function Tracking(){const path=usePathname();const [consent,setConsent]=useState(false);
 useEffect(()=>setConsent(localStorage.getItem('alisa-analytics')==='yes'),[]);
 useEffect(()=>{if(!consent)return;
  const emit=(event_type:string)=>{const search=new URLSearchParams(window.location.search);const attribution=Object.fromEntries(['utm_source','utm_medium','utm_campaign'].map(k=>[k,search.get(k)||'OTHER']));void fetch('/api/public/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_id:crypto.randomUUID(),event_type,analytics_consent:true,attribution}),referrerPolicy:'no-referrer'}).catch(()=>{});};
  if(path==='/')emit('landing.view');else if(path==='/examples')emit('demo.opened');
  const click=(e:MouseEvent)=>{if((e.target as Element)?.closest('a')?.getAttribute('href')==='/join')emit('cta.clicked');};
  document.addEventListener('click',click);return()=>document.removeEventListener('click',click);
 },[path,consent]);
 return <aside className="consent-choice" aria-label="Необязательная аналитика">Необязательная аналитика: {consent?'включена':'выключена'}. На работу заявки не влияет.<button onClick={()=>{const next=!consent;localStorage.setItem('alisa-analytics',next?'yes':'no');setConsent(next);}}>{consent?'Выключить':'Разрешить'}</button></aside>;}
