import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {authEnabled,getProfile,readCookieHeader,SESSION_COOKIE} from '../../../../server/auth';
import {Releases} from './releases';
export const dynamic='force-dynamic';
export const metadata={title:'Проверка и публикация шаблонов',robots:{index:false,follow:false},referrer:'same-origin'};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(!authEnabled()||process.env.ALISA_CATALOG_RELEASE_ENABLED!=='1')return <main><h1>Публикация шаблонов пока недоступна</h1></main>;
 let staff;
 try{staff=await getProfile(readCookieHeader((await headers()).get('cookie'),SESSION_COOKIE));}
 catch{return <main><h1>Публикация временно недоступна</h1><a href="/admin">В админку</a></main>;}
 if(!staff)redirect('/login');
 if(!staff.permissions.some(p=>['catalog.edit','catalog.approve','catalog.publish'].includes(p)))return <main><h1>Нет разрешения на просмотр выпусков</h1></main>;
 const params=await searchParams,candidate=typeof params.candidate==='string'?params.candidate:'';
 return <Releases permissions={staff.permissions} initialCandidate={candidate}/>;
}
