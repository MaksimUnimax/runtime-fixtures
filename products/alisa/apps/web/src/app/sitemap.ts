import {siteOrigin} from '../server/public';
export const dynamic='force-dynamic';
export default function sitemap(){return ['','/how-it-works','/examples','/pricing','/faq','/help','/contacts','/privacy','/terms','/consents'].map(path=>({url:siteOrigin()+path}));}
