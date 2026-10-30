export function mapLink(venue){
 return venue.map_url||(venue.address?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(venue.address+' '+(venue.name||venue.venue)):'');
}
export function mapEmbed(venue){
 return venue.address?'https://www.google.com/maps?q='+encodeURIComponent(venue.address+' '+(venue.name||venue.venue))+'&output=embed':'';
}
export function invitation(match,origin){
 const when=new Intl.DateTimeFormat('en-GB',{timeZone:match.timezone,weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(match.starts_at));
 const end=new Intl.DateTimeFormat('en-GB',{timeZone:match.timezone,hour:'2-digit',minute:'2-digit'}).format(new Date(match.ends_at));
 const price=new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(match.price_cents/100);
 return `Breja FC\nReady for a game? Come join us!\n\nWhen: ${when} – ${end}\nWhere: ${match.venue}${match.address?'\n'+match.address:''}${mapLink(match)?'\nMap: '+mapLink(match):''}\nPrice: ${price} per player\n\nSave your spot here:\n${origin}/m/${match.share_token}\n\nSee you on the pitch!`;
}
export function newsText(post,field,language){
 const chosen=[language,'en','de','es','pt','ar'].find(code=>post['title_'+code]&&post['body_'+code]);
 return chosen?post[field+'_'+chosen]:'';
}
