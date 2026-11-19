
export const teams=[{name:'Schnitzelona',abbr:'SC',color:'#bb4045',kit:'Rojo',place:1,players:[['Caldinhas',6],['Vô',1],['Eduardo',null],['Renzo',1],['Kelly',1],['Dante',null],['André',null],['Asadito',2]]},{name:'Galataspeckaray',abbr:'GS',color:'#72818b',kit:'Blanco',place:2,players:[['Ehsam',2],['Baha',1],['Selim',null],['Veri',null],['Wisdom',3],['Bahr',1],['Saurabh',null]]},{name:'Kasspress Rangers',abbr:'KR',color:'#b99a24',kit:'Amarillo',place:3,players:[['Friedrich',1],['Nuno',7],['Nogueira',null],['Patrick',1],['Zaber',null],['Luís',3],['José',null],['Rui',null]]},{name:'Wurst Ham United',abbr:'WH',color:'#396bae',kit:'Azul',place:4,players:[['Fabian',null],['Jakob',null],['Giancarlo',2],['Laurence',null],['Kordian',null],['Guilherme',null],['Hannes',null]]}];
export const editions={2022:{n:'I',winner:'Brasil',players:'Gaúcho, Beto, Douglas, Thomas, Fernando, Ricardo, André y Klaus',penalty:null},2024:{n:'II',winner:'Stiegl',players:'Daniel, Nico, Marko y José (Arg)',penalty:'Baha',note:'André y Lucca fueron porteros para los cuatro equipos.'},2025:{n:'III',winner:'Serles',players:'Alex, Baho, Tomas (Arg), Renzo, Selim, Eduard y Tashi',penalty:'Guilherme'},2026:{n:'IV',winner:'Schnitzelona',players:'Caldinhas, Vô, Eduardo, Renzo, Kelly, Dante, André y Asadito',penalty:'Patrick'}};

export function scorerRanking(){
 const records=teams.flatMap(team=>team.players.filter(([,goals])=>goals!==null).map(([name,goals])=>({name,goals,team:team.name,color:team.color}))).sort((a,b)=>b.goals-a.goals||a.name.localeCompare(b.name));
 return records.map(player=>({...player,rank:records.findIndex(other=>other.goals===player.goals)+1}));
}

// Illustrative 2027 data: fictional teams, results and players, identified as a visual mockup.
export const demo2027={teams:[
{name:'Team North',abbr:'N',color:'#bb4045',kit:'Red',players:['Alex Morgan','Sam Rivera','Leo Costa','Max Weber','Jamie Park','Nico Silva','Robin Lee']},
{name:'Team South',abbr:'S',color:'#72818b',kit:'White',players:['Taylor Reed','Chris Bauer','Dani Alves','Luca Rossi','Mika Ito','Noah Klein','Rafa Lima']},
{name:'Team East',abbr:'E',color:'#b99a24',kit:'Yellow',players:['Jordan Cole','Ben Fischer','Toni Cruz','Ari Tanaka','Emil Novak','Felix Wolf','Kai Santos']},
{name:'Team West',abbr:'W',color:'#396bae',kit:'Blue',players:['Casey Young','Marco Dias','Owen Clark','Luis Mendes','Theo Martin','Ivan Petrov','Adam King']}],
matches:[['Team North','Team South',3,1],['Team East','Team West',2,2],['Team North','Team East',1,2],['Team West','Team South',0,1],['Team North','Team West',4,1],['Team South','Team East',2,2],['Team South','Team North',1,2],['Team West','Team East',3,1],['Team East','Team North',0,0],['Team South','Team West',3,2],['Team West','Team North',1,1],['Team East','Team South',2,1],['Team South','Team West',1,0],['Team North','Team East',2,1]],
scorers:[['Alex Morgan','Team North',5],['Dani Alves','Team South',4],['Jordan Cole','Team East',4],['Marco Dias','Team West',3],['Leo Costa','Team North',3],['Rafa Lima','Team South',2],['Emil Novak','Team East',2],['Owen Clark','Team West',2],['Max Weber','Team North',1],['Taylor Reed','Team South',1],['Toni Cruz','Team East',1],['Luis Mendes','Team West',1]]};
