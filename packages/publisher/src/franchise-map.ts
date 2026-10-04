export type Franchise = { name: string; slug: string; priority: number | null; names: readonly string[] };

export const FRANCHISES: readonly Franchise[] = [
  { name: "Zenless Zone Zero", slug: "zzz", priority: 1, names: [
    "Nicole", "Belle", "Ellen", "Zhu Yuan", "Burnice", "Miyabi", "Yanagi", "Caesar", "Lucy", "Piper", "Corin", "Koleda", "Grace", "Lycaon", "Seth", "Rina", "Soukaku", "Qingyi", "Jane Doe", "Pulchra", "Anby", "Billy", "Anton", "Ben", "Lighter", "Astra Yao", "Evelyn", "Trigger", "Soldier 11", "Nekomata", "Ju Fufu", "Yuzuha", "Remielle", "Vivian", "Sigrid", "Hugo", "Harumasa", "Seed", "Aria", "Banyue", "Cissia", "Dialyn", "Lucia", "Manato", "Nangong Yu", "Norma", "Orphie & Magus", "Pan Yinhu", "Phoenix", "Promeia", "Pyrois", "Roxy", "Severian", "Sunbringer", "Sunna", "The Storyteller", "Velina", "Ye Shunguang", "Yidhari", "Yixuan", "Zhao",
  ] },
  { name: "Genshin Impact", slug: "genshin", priority: 2, names: [
    "Nilou", "Mona", "Furina", "Ganyu", "Hu Tao", "Rosaria", "Eula", "Klee", "Ayaka", "Raiden Shogun", "Keqing", "Jean", "Barbara", "Xiangling", "Amber", "Nahida", "Yae Miko", "Shenhe", "Yelan", "Dehya", "Xiao", "Diluc", "Venti", "Zhongli", "Tartaglia", "Albedo", "Kazuha", "Yoimiya", "Kokomi", "Sara", "Itto", "Gorou", "Thoma", "Sayu", "Heizou", "Collei", "Tighnari", "Cyno", "Candace", "Layla", "Faruzan", "Wanderer", "Alhaitham", "Baizhu", "Kaveh", "Lynette", "Lyney", "Freminet", "Navia", "Chevreuse", "Sigewinne", "Clorinde", "Emilie", "Mualani", "Kinich", "Kachina", "Xilonen", "Chasca", "Ororon", "Citlali", "Mavuika", "Iansan", "Odette", "Arlecchino", "Alyosha", "Flins", "Ineffa",
  ] },
  { name: "Honkai Star Rail", slug: "hsr", priority: 3, names: [
    "Kafka", "Seele", "Bronya", "Himeko", "Tingyun", "Fu Xuan", "Silver Wolf", "Ruan Mei", "Black Swan", "Acheron", "Aventurine", "Robin", "Firefly", "Boothill", "Jade", "Topaz", "Yunli", "March 7th", "Dan Heng", "Welt", "Sushang", "Clara", "Hook", "Qingque", "Asta", "Herta", "Guinaifen", "Luka", "Yukong", "Lynx", "Dr. Ratio", "Argenti", "Misha", "Sunday", "Lingsha", "Feixiao", "Moze", "Castorice", "Hyacine", "Anaxa", "Tribbie", "Mydei", "Cerydra", "Phainon",
  ] },
  { name: "Wuthering Waves", slug: "wutheringwaves", priority: 4, names: [
    "Jiyan", "Yinlin", "Calcharo", "Verina", "Encore", "Lingyang", "Changli", "Xiangli Yao", "Zhezhi", "Shorekeeper", "Camellya", "Carlotta",
  ] },
  { name: "NIKKE", slug: "nikke", priority: null, names: [
    "Rapi", "Neon", "Dorothy", "Elegg", "Emma", "Epinel", "Ether", "Exia", "Folkwang", "Frima", "Guilty", "Helm", "Isabel", "Laplace", "Liter", "Ludmilla", "Maiden", "Mana", "Marciana", "Mari", "Mast", "Maxwell", "Mihara", "Modernia", "Moran", "N102", "Naga", "Noir", "Noise", "Pepper", "Power", "Privaty", "Quency", "Ram", "Rapunzel", "Red Hood", "Rem", "Rosanna", "Rouge", "Rupee", "Sakura", "Signal", "Sin", "Snow White", "Soline", "Sora", "Sugar", "Tia", "Trina", "Trony", "Viper", "Volume", "Yulha", "Zwei",
  ] },
  { name: "Nier: Automata", slug: "nier", priority: null, names: ["2B", "A2", "21o", "6o", "9S", "Devola", "Popola", "Kainé", "Emil"] },
  { name: "Resident Evil", slug: "residentevil", priority: null, names: ["Alice", "Anis", "Drake", "Harran", "Eve", "Jackal", "Jill Valentine", "Julia", "Claire Redfield"] },
  { name: "Evangelion", slug: "evangelion", priority: null, names: ["Misato"] },
  { name: "Spy x Family", slug: "spyxfamily", priority: null, names: ["Yor", "Anya", "Loid"] },
  { name: "Xenoblade Chronicles", slug: "xenoblade", priority: null, names: ["Pyra", "Mythra", "Nia", "Melia", "Fiora", "Homura", "Hikari"] },
  { name: "Overwatch", slug: "overwatch", priority: null, names: ["Mercy", "Tracer", "D.Va", "Widowmaker", "Kiriko", "Sombra", "Sojourn"] },
  { name: "Vocaloid", slug: "vocaloid", priority: null, names: ["Miku", "Rin", "Len", "Luka", "Kaito", "Meiko", "Gumi", "IA"] },
  { name: "Final Fantasy VII", slug: "ff7", priority: null, names: ["Tifa", "Aerith", "Yuffie", "Barret", "Red XIII", "Cait Sith", "Vincent", "Cid", "Jessie", "Biggs", "Wedge", "Roche"] },
  { name: "Dead or Alive", slug: "doa", priority: null, names: ["Kasumi", "Ayane", "Hitomi", "Hayabusa", "Christie", "Tina", "Kokoro", "Mila", "Marie Rose", "Honoka", "NiCO", "Kula Diamond"] },
  { name: "King of Fighters", slug: "kof", priority: null, names: ["Mai Shiranui", "Athena Asamiya", "King", "Yuri Sakazaki", "Leona", "Shermie", "Angel", "Blue Mary", "Kim Kaphwan", "Iori", "Kyo", "Terry Bogard", "Ryo Sakazaki", "Mature", "Vice"] },
  { name: "Marvel Rivals", slug: "marvelrivals", priority: null, names: ["Emma", "Luna Snow", "Hela", "Scarlet Witch", "Psylocke", "Storm", "Squirrel Girl", "Invisible Woman", "Mantis", "Black Widow", "Shuri", "Sable", "Dagger"] },
  { name: "Skyrim", slug: "skyrim", priority: null, names: ["Serana", "Aela", "Lydia", "Mjoll", "Karliah", "Eola", "Muiri", "Ysolda"] },
  { name: "Street Fighter", slug: "streetfighter", priority: null, names: ["Chun-Li", "Cammy", "Ryu", "Ken", "Juri", "Poison", "Menat", "Karin", "Sakura", "Ibuki", "R. Mika", "Laura", "Manon", "Marisa"] },
  { name: "League of Legends", slug: "lol", priority: null, names: ["Ahri", "Jinx", "Miss Fortune", "Evelynn", "Kai'Sa", "Sona", "Seraphine", "Caitlyn", "Lux", "Akali"] },
  { name: "Touhou", slug: "touhou", priority: null, names: ["Reimu", "Marisa", "Sakuya", "Remilia", "Flandre", "Cirno", "Patchouli", "Meiling", "Koakuma", "Suwako", "Kanako", "Sanae", "Youmu", "Yuyuko", "Reisen", "Tewi", "Eirin", "Kaguya", "Mokou"] },
  { name: "Hololive", slug: "hololive", priority: null, names: ["Kronii", "Mococo", "Fuwawa", "Gura", "Calliope", "Kiara", "Ina", "Pekora", "Marine", "Flare", "Aqua", "Subaru", "Ayame", "Okayu", "Korone", "Towa", "Luna", "Kanata", "Coco", "Laplus", "Lui", "Koyori", "Chloe", "IRyS", "Sana", "Fauna", "Mumei", "Nerissa", "Bijou"] },
  { name: "Arknights", slug: "arknights", priority: null, names: ["Amiya", "Exusiai", "SilverAsh", "Eyjafjalla", "Saria", "Hoshiguma", "Surtr", "Thorns", "Mountain", "Saga", "Kal'tsit", "W", "Rosmontis", "Mudrock", "Lappland", "Texas", "Ch'en", "Nearl", "Reed", "Bagpipe"] },
  { name: "Arknights: Endfield", slug: "endfield", priority: null, names: ["Arcane", "Gilberta", "Estella", "Perlica", "Liino", "Mi Fu", "Snowshine", "Typhoeus", "Yvonne", "Zhuang Fangyi"] },
  { name: "Punishing: Gray Raven", slug: "pgr", priority: null, names: ["Lucia", "Lee", "Bianca", "Karenina", "Liv", "Nanami", "Alpha", "Rosetta", "Vera", "Wanshi"] },
  { name: "Granblue Fantasy", slug: "granblue", priority: null, names: ["Narmaya", "Anila", "Katalina", "Yuel", "Metera", "Zeta", "Ferry"] },
  { name: "Fate/Grand Order", slug: "fgo", priority: null, names: ["Aesc", "Mash", "Artoria", "Jeanne", "Ishtar", "Ereshkigal", "Tamamo", "Scathach", "Musashi", "Jalter", "Kama", "Castoria", "Morgan"] },
  { name: "Dragon Age", slug: "dragonage", priority: null, names: ["Morrigan", "Leliana", "Cassandra", "Sera", "Vivienne", "Josephine"] },
  { name: "Azur Lane", slug: "azurlane", priority: null, names: ["Taihou", "Belfast", "Enterprise", "Laffey", "Javelin", "Ayanami", "Amagi", "Nagato", "Prinz Eugen", "Bismarck", "Atago", "Takao"] },
  { name: "Girls' Frontline", slug: "girlsfrontline", priority: null, names: ["M4A1", "ST AR-15", "SOPMOD II", "UMP45", "HK416", "AK-12", "AN-94", "Vector", "SVD"] },
  { name: "Blue Archive", slug: "bluearchive", priority: null, names: ["Ako", "Aru", "Mutsuki", "Haruka", "Kayoko", "Haruna", "Iori", "Hifumi", "Azusa", "Neru", "Toki", "Mika", "Yuuka", "Hoshino"] },
  { name: "Tekken", slug: "tekken", priority: null, names: ["Nina Williams", "Jun Kazama", "Asuka Kazama", "Lili", "Alisa", "Xiaoyu", "Zafina", "Reina"] },
] as const;

const INDEX = new Map<string, Franchise>();
for (const franchise of FRANCHISES) for (const name of franchise.names) {
  const key = normalize(name);
  if (!INDEX.has(key)) INDEX.set(key, franchise);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const FRANCHISE_TOKENS = new Set([
  "zzz", "genshin", "hsr", "honkai", "rail", "waves", "wuthering", "nikke", "nier", "ff7", "ffvii",
  "arknights", "endfield", "evangelion", "overwatch", "vocaloid", "hololive", "touhou", "granblue",
  "skyrim", "pgr", "fgo", "doa", "kof", "lol", "gfl", "tekken", "spyxfamily", "xenoblade",
  "azurlane", "bluearchive", "streetfighter", "dragonage", "ff",
]);

function withStrippedFranchiseTokens(value: string): string[] {
  const variants = [value];
  let words = value.split(/\s+/);
  while (words.length > 1 && FRANCHISE_TOKENS.has(normalize(words[words.length - 1]))) {
    words = words.slice(0, -1);
    variants.push(words.join(" "));
  }
  return variants;
}

export function resolveFranchise(character: string | null | undefined): Franchise | null {
  if (!character) return null;
  const candidates = [character];
  if (character.includes("&")) candidates.push(...character.split(/\s*&\s*/).map((part) => part.trim()).filter(Boolean));
  else {
    const pair = /^(.+?)\s+(?:x|and)\s+(.+)$/i.exec(character);
    if (pair) candidates.push(pair[1].trim());
  }
  for (const candidate of candidates) {
    for (const variant of withStrippedFranchiseTokens(candidate)) {
      const found = INDEX.get(normalize(variant));
      if (found) return found;
    }
  }
  return null;
}
