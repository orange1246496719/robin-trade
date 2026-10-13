import {CHAIN,RPC,EXPLORER} from './core';
import type {Wallet} from './engine';
export type Choice={id:string;name:string;provider:Wallet};
export function discoverWallets(win:Window,changed:(choices:Choice[])=>void){
 const choices=new Map<string,Choice>();
 const fallback=(win as Window&{ethereum?:Wallet}).ethereum;
 if(fallback?.request)choices.set('injected',{id:'injected',name:'浏览器钱包（兼容模式）',provider:fallback});
 const announce=(event:Event)=>{const d=(event as CustomEvent).detail;if(!d?.info||typeof d.info.uuid!=='string'||typeof d.info.name!=='string'||typeof d.provider?.request!=='function')return;
 if(choices.get('injected')?.provider===d.provider)choices.delete('injected');
 if(!choices.has(d.info.uuid))choices.set(d.info.uuid,{id:d.info.uuid,name:d.info.name.slice(0,80),provider:d.provider});changed([...choices.values()]);};
 win.addEventListener('eip6963:announceProvider',announce);changed([...choices.values()]);win.dispatchEvent(new Event('eip6963:requestProvider'));
 return ()=>win.removeEventListener('eip6963:announceProvider',announce);
}
export async function switchChain(wallet:Wallet){
 const switchTo=()=>wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN}]});
 try{await switchTo();}catch(e){if((e as {code?:unknown})?.code!==4902)throw e;
 await wallet.request({method:'wallet_addEthereumChain',params:[{chainId:CHAIN,chainName:'Robinhood Chain',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:[RPC],blockExplorerUrls:[EXPLORER]}]});await switchTo();}
}
