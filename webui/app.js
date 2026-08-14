/**
 * ANIMU Control Panel — Web UI Application Core
 * Dual-Shell Support:
 *   - Dark Horizon HUD (Design 1)
 *   - Light Editorial Slate Workstation (Design 2)
 */

(function () {
  'use strict';

  // SVG Placeholder for offline / broken image handling
  const SVG_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 300' width='200' height='300' fill='%23111827'%3E%3Crect width='200' height='300' fill='%231e293b'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2364748b' font-family='sans-serif' font-size='14'%3EANIMU%3C/text%3E%3C/svg%3E";

  // Curated Fallback Data (Instantly ready & verified across all 9 viewports)
  const FALLBACK_DATA = {
    trending: [
      {"id": 180136, "title": {"romaji": "Tsuihou Sareta Tensei Juukishi wa Game Chishiki de Musou Suru", "english": "The Exiled Heavy Knight Knows How to Game the System"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx180136-gtMTCRlOD4OE.jpg"}, "averageScore": 67, "format": "TV", "seasonYear": 2026, "episodes": 26, "popularity": 52303, "nextAiringEpisode": {"episode": 8, "timeUntilAiring": 571307}},
      {"id": 208044, "title": {"romaji": "Rakudai Kenja no Gakuin Musou: Nidome no Tensei, S-Rank Cheat Majutsushi Bouken-roku", "english": "From Overshadowed to Overpowered: Second Reincarnation of a Talentless Sage"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx208044-Pm2UhvApQFUh.jpg"}, "averageScore": 65, "format": "ONA", "seasonYear": 2026, "episodes": null, "popularity": 43451, "nextAiringEpisode": {"episode": 9, "timeUntilAiring": 569747}},
      {"id": 196187, "title": {"romaji": "Super no Ura de Yani Suu Futari", "english": "Smoking Behind the Supermarket with You"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx196187-0dgFi2CPp3xn.jpg"}, "averageScore": 82, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 104986, "nextAiringEpisode": {"episode": 7, "timeUntilAiring": 569507}},
      {"id": 207141, "title": {"romaji": "Yani Neko", "english": "Chainsmoker Cat"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx207141-h5q5KJPd6vaX.jpg"}, "averageScore": 67, "format": "TV", "seasonYear": 2026, "episodes": null, "popularity": 63173, "nextAiringEpisode": {"episode": 8, "timeUntilAiring": 571547}},
      {"id": 204466, "title": {"romaji": "Otome Kaijuu Caraméliser", "english": "KAIJU GIRL CARAMELISE"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx204466-vXMvIs4VOoQd.png"}, "averageScore": 75, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 33743, "nextAiringEpisode": {"episode": 8, "timeUntilAiring": 575027}},
      {"id": 189046, "title": {"romaji": "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season", "english": "Re:ZERO -Starting Life in Another World- Season 4"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx189046-yaHWtS5FII46.jpg"}, "averageScore": 90, "format": "TV", "seasonYear": 2026, "episodes": 19, "popularity": 128853, "nextAiringEpisode": {"episode": 13, "timeUntilAiring": 476147}},
      {"id": 21, "title": {"romaji": "ONE PIECE", "english": "ONE PIECE"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21-ELSYx3yMPcKM.jpg"}, "averageScore": 87, "format": "TV", "seasonYear": 1999, "episodes": null, "popularity": 740734, "nextAiringEpisode": {"episode": 1174, "timeUntilAiring": 221507}},
      {"id": 269, "title": {"romaji": "BLEACH", "english": "Bleach"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx269-d2GmRkJbMopq.png"}, "averageScore": 79, "format": "TV", "seasonYear": 2004, "episodes": 366, "popularity": 511065, "nextAiringEpisode": null},
      {"id": 135865, "title": {"romaji": "Youjo Senki II", "english": "Saga of Tanya the Evil Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx135865-T7XIPMAbqcxN.png"}, "averageScore": 81, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 86695, "nextAiringEpisode": {"episode": 7, "timeUntilAiring": 474347}},
      {"id": 178789, "title": {"romaji": "Mushoku Tensei III: Isekai Ittara Honki Dasu", "english": "Mushoku Tensei: Jobless Reincarnation Season 3"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx178789-hNXjKFzUq7mk.jpg"}, "averageScore": 84, "format": "TV", "seasonYear": 2026, "episodes": 14, "popularity": 141893, "nextAiringEpisode": {"episode": 8, "timeUntilAiring": 224147}},
      {"id": 194829, "title": {"romaji": "Katainaka no Ossan, Kensei ni Naru II", "english": "From Old Country Bumpkin to Master Swordsman II"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx194829-bZKwhfo60EuF.jpg"}, "averageScore": 71, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 38848, "nextAiringEpisode": {"episode": 7, "timeUntilAiring": 482507}},
      {"id": 198946, "title": {"romaji": "Clevatess II: Majuu no Ou to Itsuwari no Yuusha Denshou", "english": "Clevatess Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx198946-IGXmbqBEYRYD.jpg"}, "averageScore": 75, "format": "TV", "seasonYear": 2026, "episodes": 13, "popularity": 39464, "nextAiringEpisode": {"episode": 7, "timeUntilAiring": 472547}}
    ],
    popular: [
      {"id": 16498, "title": {"romaji": "Shingeki no Kyojin", "english": "Attack on Titan"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx16498-buvcRTBx4NSm.jpg"}, "averageScore": 85, "format": "TV", "seasonYear": 2013, "episodes": 25, "popularity": 1042021, "nextAiringEpisode": null},
      {"id": 101922, "title": {"romaji": "Kimetsu no Yaiba", "english": "Demon Slayer: Kimetsu no Yaiba"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx101922-WBsBl0ClmgYL.jpg"}, "averageScore": 83, "format": "TV", "seasonYear": 2019, "episodes": 26, "popularity": 983384, "nextAiringEpisode": null},
      {"id": 113415, "title": {"romaji": "Jujutsu Kaisen", "english": "JUJUTSU KAISEN"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx113415-LHBAeoZDIsnF.jpg"}, "averageScore": 84, "format": "TV", "seasonYear": 2020, "episodes": 24, "popularity": 959669, "nextAiringEpisode": null},
      {"id": 1535, "title": {"romaji": "DEATH NOTE", "english": "Death Note"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1535-kUgkcrfOrkUM.jpg"}, "averageScore": 84, "format": "TV", "seasonYear": 2006, "episodes": 37, "popularity": 950182, "nextAiringEpisode": null},
      {"id": 21459, "title": {"romaji": "Boku no Hero Academia", "english": "My Hero Academia"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21459-nYh85uj2Fuwr.jpg"}, "averageScore": 77, "format": "TV", "seasonYear": 2016, "episodes": 13, "popularity": 865236, "nextAiringEpisode": null},
      {"id": 11061, "title": {"romaji": "HUNTER×HUNTER (2011)", "english": "Hunter x Hunter (2011)"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx11061-y5gsT1hoHuHw.png"}, "averageScore": 89, "format": "TV", "seasonYear": 2011, "episodes": 148, "popularity": 831771, "nextAiringEpisode": null},
      {"id": 21087, "title": {"romaji": "One Punch Man", "english": "One-Punch Man"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21087-B5DHjqZ3kW4b.jpg"}, "averageScore": 83, "format": "TV", "seasonYear": 2015, "episodes": 12, "popularity": 760237, "nextAiringEpisode": null},
      {"id": 21, "title": {"romaji": "ONE PIECE", "english": "ONE PIECE"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21-ELSYx3yMPcKM.jpg"}, "averageScore": 87, "format": "TV", "seasonYear": 1999, "episodes": null, "popularity": 740734, "nextAiringEpisode": {"episode": 1174, "timeUntilAiring": 221507}},
      {"id": 20605, "title": {"romaji": "Tokyo Ghoul", "english": "Tokyo Ghoul"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/b20605-k665mVkSug8D.jpg"}, "averageScore": 76, "format": "TV", "seasonYear": 2014, "episodes": 12, "popularity": 732495, "nextAiringEpisode": null},
      {"id": 20958, "title": {"romaji": "Shingeki no Kyojin Season 2", "english": "Attack on Titan Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx20958-HuFJyr54Mmir.jpg"}, "averageScore": 85, "format": "TV", "seasonYear": 2017, "episodes": 12, "popularity": 726244, "nextAiringEpisode": null},
      {"id": 5114, "title": {"romaji": "Hagane no Renkinjutsushi: FULLMETAL ALCHEMIST", "english": "Fullmetal Alchemist: Brotherhood"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx5114-nSWCgQlmOMtj.jpg"}, "averageScore": 90, "format": "TV", "seasonYear": 2009, "episodes": 64, "popularity": 720687, "nextAiringEpisode": null},
      {"id": 20, "title": {"romaji": "NARUTO", "english": "Naruto"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx20-dE6UHbFFg1A5.jpg"}, "averageScore": 80, "format": "TV", "seasonYear": 2002, "episodes": 220, "popularity": 717326, "nextAiringEpisode": null}
    ],
    top: [
      {"id": 154587, "title": {"romaji": "Sousou no Frieren", "english": "Frieren: Beyond Journey’s End"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx154587-qQTzQnEJJ3oB.jpg"}, "averageScore": 91, "format": "TV", "seasonYear": 2023, "episodes": 28, "popularity": 469820},
      {"id": 114129, "title": {"romaji": "Gintama: THE FINAL", "english": "Gintama: THE VERY FINAL"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx114129-RLgSuh6YbeYx.jpg"}, "averageScore": 91, "format": "MOVIE", "seasonYear": 2021, "episodes": 1, "popularity": 54896},
      {"id": 20996, "title": {"romaji": "Gintama°", "english": "Gintama Season 3"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx20996-kBEGEGdeK1r7.jpg"}, "averageScore": 90, "format": "TV", "seasonYear": 2015, "episodes": 51, "popularity": 118705},
      {"id": 171627, "title": {"romaji": "Chainsaw Man: Reze-hen", "english": "Chainsaw Man – The Movie: Reze Arc"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx171627-ZN9D7P46yHnw.png"}, "averageScore": 90, "format": "MOVIE", "seasonYear": 2025, "episodes": 1, "popularity": 229156},
      {"id": 5114, "title": {"romaji": "Hagane no Renkinjutsushi: FULLMETAL ALCHEMIST", "english": "Fullmetal Alchemist: Brotherhood"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx5114-nSWCgQlmOMtj.jpg"}, "averageScore": 90, "format": "TV", "seasonYear": 2009, "episodes": 64, "popularity": 720687},
      {"id": 189046, "title": {"romaji": "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season", "english": "Re:ZERO -Starting Life in Another World- Season 4"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx189046-yaHWtS5FII46.jpg"}, "averageScore": 90, "format": "TV", "seasonYear": 2026, "episodes": 19, "popularity": 128853},
      {"id": 182469, "title": {"romaji": "ONE PIECE FAN LETTER", "english": "ONE PIECE FAN LETTER"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx182469-JQ808NBPxmgn.jpg"}, "averageScore": 90, "format": "SPECIAL", "seasonYear": 2024, "episodes": 1, "popularity": 56925},
      {"id": 104578, "title": {"romaji": "Shingeki no Kyojin Season 3 Part 2", "english": "Attack on Titan Season 3 Part 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx104578-k61nx3LPjvgd.jpg"}, "averageScore": 90, "format": "TV", "seasonYear": 2019, "episodes": 10, "popularity": 604685},
      {"id": 124194, "title": {"romaji": "Fruits Basket: The Final", "english": "Fruits Basket The Final Season"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx124194-TJlqMMR7BGn9.jpg"}, "averageScore": 89, "format": "TV", "seasonYear": 2021, "episodes": 13, "popularity": 175242},
      {"id": 11061, "title": {"romaji": "HUNTER×HUNTER (2011)", "english": "Hunter x Hunter (2011)"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx11061-y5gsT1hoHuHw.png"}, "averageScore": 89, "format": "TV", "seasonYear": 2011, "episodes": 148, "popularity": 831771},
      {"id": 9253, "title": {"romaji": "Steins;Gate", "english": "Steins;Gate"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx9253-tIUXF2gfU8Sg.jpg"}, "averageScore": 89, "format": "TV", "seasonYear": 2011, "episodes": 24, "popularity": 588392},
      {"id": 21745, "title": {"romaji": "Owarimonogatari (Ge)", "english": "Owarimonogatari Second Season"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21745-VrhhJjZNdBXV.png"}, "averageScore": 89, "format": "TV", "seasonYear": 2017, "episodes": 7, "popularity": 122916}
    ],
    seasonal: [
      {"id": 178789, "title": {"romaji": "Mushoku Tensei III: Isekai Ittara Honki Dasu", "english": "Mushoku Tensei: Jobless Reincarnation Season 3"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx178789-hNXjKFzUq7mk.jpg"}, "averageScore": 84, "format": "TV", "seasonYear": 2026, "episodes": 14, "popularity": 141893, "nextAiringEpisode": {"episode": 8, "timeUntilAiring": 224147}},
      {"id": 196187, "title": {"romaji": "Super no Ura de Yani Suu Futari", "english": "Smoking Behind the Supermarket with You"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx196187-0dgFi2CPp3xn.jpg"}, "averageScore": 82, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 104986, "nextAiringEpisode": {"episode": 7, "timeUntilAiring": 569507}},
      {"id": 135865, "title": {"romaji": "Youjo Senki II", "english": "Saga of Tanya the Evil Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx135865-T7XIPMAbqcxN.png"}, "averageScore": 81, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 86695, "nextAiringEpisode": {"episode": 7, "timeUntilAiring": 474347}},
      {"id": 185874, "title": {"romaji": "BLEACH: Sennen Kessen-hen - Kashin-tan", "english": "BLEACH: Thousand-Year Blood War - The Calamity"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx185874-aU3e6tBT6wwA.jpg"}, "averageScore": 88, "format": "TV", "seasonYear": 2026, "episodes": 10, "popularity": 71608, "nextAiringEpisode": {"episode": 6, "timeUntilAiring": 312000}},
      {"id": 207141, "title": {"romaji": "Yani Neko", "english": "Chainsmoker Cat"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx207141-h5q5KJPd6vaX.jpg"}, "averageScore": 67, "format": "TV", "seasonYear": 2026, "episodes": null, "popularity": 63173, "nextAiringEpisode": {"episode": 8, "timeUntilAiring": 571547}},
      {"id": 187538, "title": {"romaji": "BLACK TORCH", "english": "BLACK TORCH"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx187538-fXVXKYUA3VV6.jpg"}, "averageScore": 71, "format": "TV", "seasonYear": 2026, "episodes": null, "popularity": 58842, "nextAiringEpisode": {"episode": 5, "timeUntilAiring": 198000}},
      {"id": 180136, "title": {"romaji": "Tsuihou Sareta Tensei Juukishi wa Game Chishiki de Musou Suru", "english": "The Exiled Heavy Knight Knows How to Game the System"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx180136-gtMTCRlOD4OE.jpg"}, "averageScore": 67, "format": "TV", "seasonYear": 2026, "episodes": 26, "popularity": 52303, "nextAiringEpisode": {"episode": 8, "timeUntilAiring": 571307}},
      {"id": 210031, "title": {"romaji": "Seihantai na Kimi to Boku 2nd Season", "english": "You and I Are Polar Opposites Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx210031-TppgcHZh46LY.jpg"}, "averageScore": 82, "format": "TV", "seasonYear": 2026, "episodes": 13, "popularity": 51397, "nextAiringEpisode": {"episode": 6, "timeUntilAiring": 412000}},
      {"id": 103303, "title": {"romaji": "Nijusseiki Denki Mokuroku: Eureka Evrika", "english": "Sparks of Tomorrow"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx103303-IF43hFJPPv2Y.png"}, "averageScore": 75, "format": "TV", "seasonYear": 2026, "episodes": 13, "popularity": 50212, "nextAiringEpisode": null},
      {"id": 187260, "title": {"romaji": "Kimi ga Shinu made Koi wo Shitai", "english": "I Want to Love You Till Your Dying Day"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx187260-WW5RBa5NINRP.jpg"}, "averageScore": 74, "format": "TV", "seasonYear": 2026, "episodes": 13, "popularity": 49349, "nextAiringEpisode": null},
      {"id": 177699, "title": {"romaji": "Koukaku Kidoutai: THE GHOST IN THE SHELL", "english": "THE GHOST IN THE SHELL"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx177699-hnzc1CS5ZSM2.png"}, "averageScore": 76, "format": "TV", "seasonYear": 2026, "episodes": null, "popularity": 47762, "nextAiringEpisode": null},
      {"id": 133007, "title": {"romaji": "Mahou Shoujo Madoka☆Magica: Walpurgis no Kaiten", "english": "Puella Magi Madoka Magica the Movie -Walpurgisnacht: Rising-"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx133007-5gOUXDvzxy9S.jpg"}, "averageScore": 88, "format": "MOVIE", "seasonYear": 2026, "episodes": 1, "popularity": 47685, "nextAiringEpisode": null}
    ],
    upcoming: [
      {"id": 133007, "title": {"romaji": "Mahou Shoujo Madoka☆Magica: Walpurgis no Kaiten", "english": "Puella Magi Madoka Magica the Movie -Walpurgisnacht: Rising-"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx133007-5gOUXDvzxy9S.jpg"}, "averageScore": 88, "format": "MOVIE", "seasonYear": 2026, "episodes": 1, "popularity": 47685},
      {"id": 177699, "title": {"romaji": "Koukaku Kidoutai: THE GHOST IN THE SHELL", "english": "THE GHOST IN THE SHELL"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx177699-hnzc1CS5ZSM2.png"}, "averageScore": 76, "format": "TV", "seasonYear": 2026, "episodes": null, "popularity": 47762},
      {"id": 187538, "title": {"romaji": "BLACK TORCH", "english": "BLACK TORCH"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx187538-fXVXKYUA3VV6.jpg"}, "averageScore": 71, "format": "TV", "seasonYear": 2026, "episodes": null, "popularity": 58842},
      {"id": 103303, "title": {"romaji": "Nijusseiki Denki Mokuroku: Eureka Evrika", "english": "Sparks of Tomorrow"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx103303-IF43hFJPPv2Y.png"}, "averageScore": 75, "format": "TV", "seasonYear": 2026, "episodes": 13, "popularity": 50212},
      {"id": 187260, "title": {"romaji": "Kimi ga Shinu made Koi wo Shitai", "english": "I Want to Love You Till Your Dying Day"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx187260-WW5RBa5NINRP.jpg"}, "averageScore": 74, "format": "TV", "seasonYear": 2026, "episodes": 13, "popularity": 49349},
      {"id": 159309, "title": {"romaji": "Otomege Sekai wa Mob ni Kibishii Sekai desu 2", "english": "Trapped in a Dating Sim: The World of Otome Games is Tough for Mobs Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx159309-wRfh9O1odrDJ.jpg"}, "averageScore": 67, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 47120},
      {"id": 185542, "title": {"romaji": "Gaikotsu Kishi-sama, Tadaima Isekai e Odekakechuu II", "english": "Skeleton Knight in Another World Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx185542-6a9LCWlLHa0T.jpg"}, "averageScore": 66, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 43831},
      {"id": 178789, "title": {"romaji": "Mushoku Tensei III: Isekai Ittara Honki Dasu", "english": "Mushoku Tensei: Jobless Reincarnation Season 3"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx178789-hNXjKFzUq7mk.jpg"}, "averageScore": 84, "format": "TV", "seasonYear": 2026, "episodes": 14, "popularity": 141893},
      {"id": 196187, "title": {"romaji": "Super no Ura de Yani Suu Futari", "english": "Smoking Behind the Supermarket with You"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx196187-0dgFi2CPp3xn.jpg"}, "averageScore": 82, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 104986},
      {"id": 135865, "title": {"romaji": "Youjo Senki II", "english": "Saga of Tanya the Evil Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx135865-T7XIPMAbqcxN.png"}, "averageScore": 81, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 86695},
      {"id": 185874, "title": {"romaji": "BLEACH: Sennen Kessen-hen - Kashin-tan", "english": "BLEACH: Thousand-Year Blood War - The Calamity"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx185874-aU3e6tBT6wwA.jpg"}, "averageScore": 88, "format": "TV", "seasonYear": 2026, "episodes": 10, "popularity": 71608},
      {"id": 210031, "title": {"romaji": "Seihantai na Kimi to Boku 2nd Season", "english": "You and I Are Polar Opposites Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx210031-TppgcHZh46LY.jpg"}, "averageScore": 82, "format": "TV", "seasonYear": 2026, "episodes": 13, "popularity": 51397}
    ]
  };

  // Application State
  const state = {
    activeTab: 'discover',
    theme: localStorage.getItem('theme') || 'dark',
    userName: '',
    userId: null,
    animeList: [],
    listEntriesByMedia: {},
    activeMediaDetail: null,
    activeMediaDetailId: null,
    // Discover State
    discoverFeedKey: 'trending',
    discoverFormatFilter: 'ALL',
    discoverSearchTerm: '',
    discoverSeason: 'SUMMER',
    discoverSeasonYear: 2026,
    discoverChartTab: 'Airing',
    hideOnMyList: false,
    discoverFeeds: {
      trending: [...FALLBACK_DATA.trending],
      popular: [...FALLBACK_DATA.popular],
      top: [...FALLBACK_DATA.top],
      seasonal: [...FALLBACK_DATA.seasonal],
      upcoming: [...FALLBACK_DATA.upcoming]
    },
    airingRadar: [...FALLBACK_DATA.trending],
    seasonalChart: [...FALLBACK_DATA.seasonal],
    spotlightMedia: null,
    // Lists state
    listsMediaType: 'ANIME',
    listsStatusGroup: 'ALL',
    listsViewMode: 'grid',
    listsSearch: '',
    listsSort: 'score',
    userListsData: null,
    // Search state
    searchQuery: '',
    searchEntity: 'ANIME',
    searchResults: [],
    searchPage: 1,
    searchHasNext: false,
    searchFilters: {},
    // Social state
    socialTab: 'feed',
    socialActivities: [],
    // Notifications
    notifications: [],
    unreadNotifications: 0
  };

  // Cached DOM elements
  const DOM = {
    // Shell & Navigation
    navTabs: document.querySelectorAll('.nav-tab'),
    mobileNavTabs: document.querySelectorAll('.mobile-nav-tab'),
    viewPanels: document.querySelectorAll('.view-panel'),
    themeToggles: document.querySelectorAll('.theme-toggle-btn'),
    // Modals
    mediaDetailModal: document.getElementById('media-detail-modal'),
    mediaDetailContent: document.getElementById('media-detail-content'),
    listEditorModal: document.getElementById('list-editor-modal'),
    settingsDialog: document.getElementById('settings-dialog'),
    nyaaDialog: document.getElementById('nyaa-dialog'),
    toastWrapper: document.getElementById('toast-wrapper'),
    // Notification elements
    notifBtnDark: document.getElementById('notif-btn-dark'),
    notifBadgeDark: document.getElementById('notif-badge-dark'),
    notifDropdownDark: document.getElementById('notif-dropdown-dark'),
    notifListDark: document.getElementById('notif-list-dark'),
    notifBtnLight: document.getElementById('notif-btn-light'),
    notifBadgeLight: document.getElementById('notif-badge-light'),
    notifDropdownLight: document.getElementById('notif-dropdown-light'),
    notifListLight: document.getElementById('notif-list-light'),
    // Search bars
    darkGlobalSearch: document.getElementById('dark-global-search'),
    lightGlobalSearch: document.getElementById('light-global-search'),
    // Breadcrumb
    darkBreadcrumbTab: document.getElementById('dark-breadcrumb-tab'),
    // Mobile Menus
    mobileMenuLight: document.getElementById('mobile-menu'),
    mobileMenuDark: document.getElementById('dark-mobile-menu'),
    hamburgerLight: document.getElementById('light-hamburger-btn'),
    hamburgerDark: document.getElementById('dark-mobile-menu-btn'),
  };

  // Helper: Format Time Duration
  function formatRelativeTime(seconds) {
    if (seconds <= 0) return 'Aired';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `in ${d}d ${h}h`;
    if (h > 0) return `in ${h}h ${m}m`;
    return `in ${m}m`;
  }

  function getAnimeTitle(media) {
    if (!media) return 'Untitled';
    if (typeof media === 'string') return media;
    const pref = state.titleLang || 'romaji';
    if (media.title) {
      if (pref === 'english' && media.title.english) return media.title.english;
      if (pref === 'native' && media.title.native) return media.title.native;
      return media.title.userPreferred || media.title.romaji || media.title.english || media.title.native || 'Untitled';
    }
    return media.name || 'Untitled';
  }

  function getCoverImage(media) {
    if (!media) return SVG_PLACEHOLDER;
    if (media.coverImage) {
      return media.coverImage.large || media.coverImage.extraLarge || media.coverImage.medium || SVG_PLACEHOLDER;
    }
    if (media.image) return media.image;
    return SVG_PLACEHOLDER;
  }

  function sanitizeHtml(str) {
    if (!str) return '';
    return str.replace(/<[^>]*>?/gm, '');
  }

  // Toast Notification System
  function showToast(message, type = 'info') {
    if (!DOM.toastWrapper) return;
    const toast = document.createElement('div');
    const bgClass = type === 'error'
      ? 'bg-rose-600 text-white shadow-rose-900/40'
      : type === 'success'
      ? 'bg-emerald-600 text-white shadow-emerald-900/40'
      : 'bg-slate-900 dark:bg-[#151f33] text-white border border-cyan-500/30 shadow-cyan-950/40';
    
    toast.className = `pointer-events-auto px-4 py-3 rounded-2xl shadow-xl flex items-center justify-between gap-3 text-xs font-semibold transform transition-all duration-300 translate-y-4 opacity-0 ${bgClass}`;
    toast.innerHTML = `
      <div class="flex items-center gap-2.5">
        <i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation' : type === 'success' ? 'fa-circle-check' : 'fa-info-circle'}"></i>
        <span>${message}</span>
      </div>
      <button class="text-white/60 hover:text-white" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>
    `;
    DOM.toastWrapper.appendChild(toast);
    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-4', 'opacity-0');
    });
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // API Client Interface
  const API = {
    async queryAniList(query, variables = {}) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const res = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (res.ok) {
          const json = await res.json();
          if (json.data && (!json.errors || json.errors.length === 0)) {
            return json.data;
          }
        }
      } catch (e) {
        // network or timeout fallback
      }
      return null;
    },

    async getDiscover(type) {
      try {
        const res = await fetch(`/api/anilist/discover?type=${encodeURIComponent(type || 'trending')}`);
        if (!res.ok) return { media: FALLBACK_DATA[type] || [] };
        return res.json();
      } catch (e) {
        return { media: FALLBACK_DATA[type] || [] };
      }
    },

    async getAiringToday(hours = 168) {
      try {
        const res = await fetch(`/api/anilist/airing-today?hours=${hours}`);
        if (!res.ok) return { schedules: FALLBACK_DATA.trending };
        return res.json();
      } catch (e) {
        return { schedules: FALLBACK_DATA.trending };
      }
    },

    async getAnimeList() {
      try {
        const res = await fetch('/api/anime');
        if (!res.ok) return [];
        return res.json();
      } catch (e) {
        return [];
      }
    },

    async getDownloads() {
      try {
        const res = await fetch('/api/downloads');
        if (!res.ok) return [];
        return res.json();
      } catch (e) {
        return [];
      }
    },

    async searchNyaa(mediaId, episode) {
      const payload = {};
      if (episode !== undefined) payload.episode = episode;
      const res = await fetch(`/api/anime/${mediaId}/nyaa-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to query Nyaa index');
      return res.json();
    },

    async downloadNyaa(mediaId, link, episode) {
      const res = await fetch(`/api/anime/${mediaId}/nyaa-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link, episode })
      });
      if (!res.ok) throw new Error('Failed to start torrent download');
      return res.json();
    },

    async getConfig() {
      try {
        const res = await fetch('/api/config');
        if (!res.ok) return {};
        return res.json();
      } catch (e) {
        return {};
      }
    },

    async saveConfig(payload) {
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to save config');
      return res.json();
    },

    async getLogs(name = 'combined', lines = 250) {
      try {
        const res = await fetch(`/api/logs?name=${encodeURIComponent(name)}&lines=${lines}`);
        if (!res.ok) return { logs: '' };
        return res.json();
      } catch (e) {
        return { logs: '' };
      }
    },

    async getDownloadHistory() {
      try {
        const res = await fetch('/api/history');
        if (!res.ok) return [];
        return res.json();
      } catch (e) {
        return [];
      }
    },

    async clearHistory() {
      const res = await fetch('/api/history', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear download history');
      return res.json();
    }
  };

  // Server-side List Entry Mutation Helper
  async function saveListEntryViaBackend(payload) {
    const res = await fetch('/api/anilist/list/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Failed to update list entry (HTTP ${res.status})`);
    return body;
  }

  // Quick Action: Add directly to watching list
  window.quickAddWatching = async function (mediaId, title) {
    try {
      showToast(`Adding "${title || 'Anime'}" to Watching...`, 'info');
      await saveListEntryViaBackend({ mediaId: parseInt(mediaId), status: 'CURRENT' });
      showToast(`Added "${title || 'Anime'}" to Watching list!`, 'success');
      state.listEntriesByMedia[mediaId] = {
        ...(state.listEntriesByMedia[mediaId] || {}),
        mediaId: parseInt(mediaId),
        status: 'CURRENT'
      };
      if (state.activeTab === 'watching') loadWatching();
      if (state.activeTab === 'lists') loadUserListsData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Quick Action: Open Nyaa Episode Search Modal
  window.quickNyaaSearch = async function (mediaId, title) {
    openNyaaModal(mediaId, title);
  };

  // ==============================================================
  // THEME SWITCHER SYSTEM
  // ==============================================================
  function initTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    state.theme = saved;
    if (saved === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  }

  function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    state.theme = isDark ? 'dark' : 'light';
    localStorage.setItem('theme', state.theme);
    if (state.activeTab === 'discover') {
      renderDiscover();
      renderAiringRadar();
      renderSeasonalChart();
    }
  }

  // Bind Theme Toggles
  document.querySelectorAll('#theme-toggle-dark, #theme-toggle-light, .theme-toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleTheme();
    });
  });

  // ==============================================================
  // NAVIGATION & TAB SYSTEM
  // ==============================================================
  window.switchTab = function (tabName) {
    if (!tabName) return;
    state.activeTab = tabName;

    // 1. Update Dark Rail navigation buttons
    document.querySelectorAll('.dark-nav-tab').forEach(btn => {
      const isTarget = btn.dataset.tab === tabName;
      if (isTarget) {
        btn.className = 'nav-tab dark-nav-tab flex items-center gap-3 px-3 py-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/25 font-medium transition-all group cursor-pointer text-left w-full';
        const dot = btn.querySelector('.badge-glow');
        if (dot) dot.classList.remove('hidden');
      } else {
        btn.className = 'nav-tab dark-nav-tab flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-[#151f33] font-medium transition-all group cursor-pointer text-left w-full';
        const dot = btn.querySelector('.badge-glow');
        if (dot) dot.classList.add('hidden');
      }
    });

    // 2. Update Light Ribbon navigation buttons
    document.querySelectorAll('.light-nav-tab').forEach(btn => {
      const isTarget = btn.dataset.tab === tabName;
      if (isTarget) {
        btn.className = 'nav-tab light-nav-tab px-2.5 sm:px-3 py-1.5 text-xs font-bold text-editorial-crimson border-b-2 border-editorial-crimson tracking-wide flex items-center gap-1.5 flex-shrink-0 cursor-pointer transition-colors';
      } else {
        btn.className = 'nav-tab light-nav-tab px-2.5 sm:px-3 py-1.5 text-xs font-medium text-editorial-slate600 hover:text-editorial-slate900 border-b-2 border-transparent transition-colors flex-shrink-0 cursor-pointer';
      }
    });

    // 3. Update Mobile Drawer buttons
    document.querySelectorAll('.mobile-nav-tab').forEach(btn => {
      const isTarget = btn.dataset.tab === tabName;
      if (isTarget) {
        btn.classList.add('text-cyan-400', 'bg-cyan-500/10', 'text-editorial-crimson', 'bg-rose-50');
      } else {
        btn.classList.remove('text-cyan-400', 'bg-cyan-500/10', 'text-editorial-crimson', 'bg-rose-50');
      }
    });

    // 4. Update breadcrumb
    const breadcrumbTitles = {
      discover: 'Discover Matrix',
      watching: 'Watching Cockpit',
      lists: 'AniList Collection',
      search: 'Global Search',
      social: 'Social Hub',
      stats: 'Analytics & Stats',
      history: 'Download History',
      logs: 'System Logs',
      settings: 'Config & Preferences'
    };
    if (DOM.darkBreadcrumbTab) {
      DOM.darkBreadcrumbTab.textContent = breadcrumbTitles[tabName] || tabName.toUpperCase();
    }

    // 5. Toggle panel visibility
    document.querySelectorAll('.view-panel').forEach(panel => {
      panel.classList.toggle('hidden', panel.id !== `${tabName}-panel`);
    });

    // 6. Close mobile menu drawers
    document.getElementById('mobile-menu')?.classList.add('hidden');
    document.getElementById('dark-mobile-menu')?.classList.add('hidden');

    // 7. Load Tab Data
    switch (tabName) {
      case 'discover':
        loadDiscover();
        break;
      case 'watching':
        loadWatching();
        break;
      case 'lists':
        loadUserListsData();
        break;
      case 'search':
        if (state.searchResults.length === 0 && !state.searchQuery) {
          performSearch();
        }
        break;
      case 'social':
        loadSocialFeed();
        break;
      case 'stats':
        loadUserStats();
        break;
      case 'history':
        loadDownloadHistory();
        break;
      case 'logs':
        loadLogs();
        break;
      case 'settings':
        loadSettingsConfig();
        break;
    }
  };

  // Wire desktop navigation tab clicks (both dark and light shells)
  document.querySelectorAll('.dark-nav-tab, .light-nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab) {
        switchTab(btn.dataset.tab);
      }
    });
  });

  // Wire mobile navigation tab clicks
  DOM.mobileNavTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab) {
        switchTab(btn.dataset.tab);
      }
    });
  });

  // Mobile menu hamburger toggles
  DOM.hamburgerLight?.addEventListener('click', () => {
    DOM.mobileMenuLight?.classList.toggle('hidden');
  });
  DOM.hamburgerDark?.addEventListener('click', () => {
    DOM.mobileMenuDark?.classList.toggle('hidden');
  });

  // Global Search Input Handlers
  function setupGlobalSearch(inputEl) {
    if (!inputEl) return;
    inputEl.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      if (state.activeTab === 'discover') {
        state.discoverSearchTerm = term;
        renderDiscover();
      }
    });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = inputEl.value.trim();
        if (val) {
          state.searchQuery = val;
          const searchInput = document.getElementById('global-search-input');
          if (searchInput) searchInput.value = val;
          switchTab('search');
          performSearch();
        }
      }
    });
  }
  setupGlobalSearch(DOM.darkGlobalSearch);
  setupGlobalSearch(DOM.lightGlobalSearch);

  // Command-K / Ctrl-K shortcut
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const isDark = document.documentElement.classList.contains('dark');
      if (isDark && DOM.darkGlobalSearch) {
        DOM.darkGlobalSearch.focus();
        DOM.darkGlobalSearch.select();
      } else if (!isDark && DOM.lightGlobalSearch) {
        DOM.lightGlobalSearch.focus();
        DOM.lightGlobalSearch.select();
      }
    }
  });

  // ==============================================================
  // DISCOVER MATRIX & WORKSTATION CONTROLLER
  // ==============================================================
  window.switchFeed = function (feedKey) {
    if (!['trending', 'popular', 'top', 'seasonal', 'upcoming'].includes(feedKey)) return;
    state.discoverFeedKey = feedKey;

    // Update Dark HUD Tab Switchers
    document.querySelectorAll('.dark-feed-tab').forEach(btn => {
      const id = btn.id;
      const isTarget = id === `dark-tab-${feedKey}`;
      if (isTarget) {
        btn.className = 'dark-feed-tab px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-semibold tracking-wide bg-cyan-500 text-obsidian-950 shadow-sm transition-all flex items-center gap-1.5 flex-shrink-0 cursor-pointer';
      } else {
        btn.className = 'dark-feed-tab px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-semibold tracking-wide text-slate-400 hover:text-slate-100 hover:bg-[#151f33] transition-all flex items-center gap-1.5 flex-shrink-0 cursor-pointer';
      }
    });

    // Update Light Editorial Feed Buttons
    document.querySelectorAll('.light-feed-btn').forEach(btn => {
      const id = btn.id;
      const isTarget = id === `light-feed-${feedKey}`;
      if (isTarget) {
        btn.className = 'light-feed-btn w-full px-3 py-2 rounded-lg text-left text-xs font-bold bg-editorial-slate900 text-white flex items-center justify-between transition-all shadow-sm cursor-pointer';
      } else {
        btn.className = 'light-feed-btn w-full px-3 py-2 rounded-lg text-left text-xs font-semibold text-editorial-slate700 hover:bg-editorial-slate100 flex items-center justify-between transition-all cursor-pointer';
      }
    });

    renderDiscover();
    fetchFeedData(feedKey);
  };

  window.filterDiscoverFormat = function (format) {
    state.discoverFormatFilter = format || 'ALL';
    const darkSelect = document.getElementById('dark-format-filter');
    const lightSelect = document.getElementById('light-format-select');
    if (darkSelect) darkSelect.value = format;
    if (lightSelect) lightSelect.value = format;
    renderDiscover();
  };

  window.setDiscoverSeason = function (season) {
    state.discoverSeason = season;
    ['SPRING', 'SUMMER', 'FALL', 'WINTER'].forEach(s => {
      // Dark buttons
      const dBtn = document.getElementById(`dark-season-${s}`);
      if (dBtn) {
        if (s === season) {
          dBtn.className = 'dark-season-btn py-1.5 rounded-lg text-xs font-semibold bg-cyan-500 text-obsidian-950 shadow-sm transition-all text-center cursor-pointer';
        } else {
          dBtn.className = 'dark-season-btn py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white transition-all text-center cursor-pointer';
        }
      }
      // Light buttons
      const lBtn = document.getElementById(`light-season-${s}`);
      if (lBtn) {
        if (s === season) {
          lBtn.className = 'light-season-btn py-1 rounded text-xs font-bold bg-white text-editorial-slate900 shadow-sm transition-all text-center cursor-pointer';
        } else {
          lBtn.className = 'light-season-btn py-1 rounded text-xs font-semibold text-editorial-slate600 hover:text-editorial-slate900 transition-all text-center cursor-pointer';
        }
      }
    });
    fetchSeasonalChartData();
  };

  window.setDiscoverSubtab = function (subtab) {
    state.discoverChartTab = subtab;
    ['Airing', 'Upcoming', 'TBA', 'Archive'].forEach(st => {
      // Dark status buttons
      const dBtn = document.getElementById(`dark-subtab-${st}`);
      if (dBtn) {
        if (st === subtab) {
          dBtn.className = 'dark-status-btn px-2.5 py-1 rounded-md text-[11px] font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex-shrink-0 cursor-pointer';
        } else {
          dBtn.className = 'dark-status-btn px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-400 hover:text-slate-200 flex-shrink-0 cursor-pointer';
        }
      }
      // Light status buttons
      const lBtn = document.getElementById(`light-subtab-${st}`);
      if (lBtn) {
        if (st === subtab) {
          lBtn.className = 'light-status-btn px-2.5 py-1 rounded text-[11px] font-bold bg-editorial-slate900 text-white flex-shrink-0 cursor-pointer';
        } else {
          lBtn.className = 'light-status-btn px-2.5 py-1 rounded text-[11px] font-medium text-editorial-slate600 hover:text-editorial-slate900 flex-shrink-0 cursor-pointer';
        }
      }
    });
    renderSeasonalChart();
  };

  window.toggleHideMyList = function (checked) {
    state.hideOnMyList = Boolean(checked);
    const dChk = document.getElementById('dark-hide-my-list');
    const lChk = document.getElementById('light-hide-my-list');
    if (dChk) dChk.checked = state.hideOnMyList;
    if (lChk) lChk.checked = state.hideOnMyList;
    renderSeasonalChart();
  };

  // GraphQL query definitions for Discover feeds
  const DISCOVER_FEED_QUERY = `
    query ($page: Int, $perPage: Int, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int, $status: MediaStatus) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(type: ANIME, sort: $sort, season: $season, seasonYear: $seasonYear, status: $status, isAdult: false) {
          id
          title { romaji english native userPreferred }
          coverImage { extraLarge large medium color }
          bannerImage
          format
          episodes
          status
          season
          seasonYear
          averageScore
          meanScore
          popularity
          trending
          genres
          description
          nextAiringEpisode { episode airingAt timeUntilAiring }
        }
      }
    }
  `;

  async function fetchFeedData(feedKey) {
    try {
      const res = await API.getDiscover(feedKey);
      if (res && res.media && res.media.length > 0) {
        state.discoverFeeds[feedKey] = res.media;
      }
    } catch (err) {}
    renderDiscover();
  }

  async function fetchAiringRadarData() {
    try {
      const res = await API.getAiringToday(168);
      if (res && res.schedules && res.schedules.length > 0) {
        state.airingRadar = res.schedules;
      }
    } catch (err) {}
    renderAiringRadar();
  }

  async function fetchSeasonalChartData() {
    try {
      const res = await API.getDiscover('seasonal');
      if (res && res.media && res.media.length > 0) {
        state.seasonalChart = res.media;
      }
    } catch (err) {}
    renderSeasonalChart();
  }

  async function loadDiscover() {
    renderDiscover();
    renderAiringRadar();
    renderSeasonalChart();

    await Promise.allSettled([
      fetchFeedData(state.discoverFeedKey),
      fetchAiringRadarData(),
      fetchSeasonalChartData()
    ]);
  }

  // Render Discover Hero Spotlight, Main Grids, Radar, and Seasonal Chart
  function renderDiscover() {
    const feedKey = state.discoverFeedKey;
    let list = state.discoverFeeds[feedKey] || FALLBACK_DATA[feedKey] || [];

    // Filter by Format
    if (state.discoverFormatFilter !== 'ALL') {
      list = list.filter(m => m.format === state.discoverFormatFilter);
    }

    // Filter by Search Query
    if (state.discoverSearchTerm) {
      list = list.filter(m => {
        const title = getAnimeTitle(m).toLowerCase();
        return title.includes(state.discoverSearchTerm);
      });
    }

    // Update Counts & Badges
    const feedNames = {
      trending: 'Trending Pulse',
      popular: 'Most Popular',
      top: 'Top Rated',
      seasonal: `Season ${state.discoverSeasonYear || 2026}`,
      upcoming: 'Upcoming Next'
    };

    ['trending', 'popular', 'top', 'seasonal', 'upcoming'].forEach(k => {
      const count = (state.discoverFeeds[k] || FALLBACK_DATA[k] || []).length || 12;
      const dBadge = document.getElementById(`dark-badge-${k}`);
      if (dBadge) dBadge.textContent = count;
      const lBadge = document.getElementById(`light-badge-${k}`);
      if (lBadge) lBadge.textContent = count;
    });

    const dCount = document.getElementById('dark-feed-count');
    if (dCount) dCount.textContent = `${list.length} Items`;
    const lCount = document.getElementById('light-feed-count');
    if (lCount) lCount.textContent = `${list.length} Records`;
    const lTitle = document.getElementById('light-feed-title');
    if (lTitle) lTitle.textContent = feedNames[feedKey] || 'Catalog';

    // Render Spotlight Hero Banner
    const heroMedia = list[0] || FALLBACK_DATA.trending[0];
    if (heroMedia) {
      state.spotlightMedia = heroMedia;
      const title = getAnimeTitle(heroMedia);
      const cover = getCoverImage(heroMedia);
      const score = heroMedia.averageScore || heroMedia.meanScore || 88;
      const format = heroMedia.format || 'TV';
      const eps = heroMedia.episodes ? `${heroMedia.episodes} Episodes` : 'Releasing';
      const desc = sanitizeHtml(heroMedia.description) || 'Featured masterpiece in the current catalog collection.';

      // Dark Hero
      const dCover = document.getElementById('dark-hero-cover');
      if (dCover) dCover.src = cover;
      const dTitle = document.getElementById('dark-hero-title');
      if (dTitle) dTitle.textContent = title;
      const dDesc = document.getElementById('dark-hero-desc');
      if (dDesc) dDesc.textContent = desc;
      const dScore = document.getElementById('dark-hero-score');
      if (dScore) dScore.textContent = `★ ${score}%`;
      const dMeta = document.getElementById('dark-hero-meta');
      if (dMeta) dMeta.textContent = `${format} • ${eps}`;

      const dBtnAdd = document.getElementById('dark-hero-btn-add');
      if (dBtnAdd) {
        dBtnAdd.onclick = () => quickAddWatching(heroMedia.id, title);
      }
      const dBtnInsp = document.getElementById('dark-hero-btn-inspect');
      if (dBtnInsp) {
        dBtnInsp.onclick = () => openMediaDetail(heroMedia.id);
      }

      // Light Hero
      const lCover = document.getElementById('light-hero-cover');
      if (lCover) lCover.src = cover;
      const lTitleEl = document.getElementById('light-hero-title');
      if (lTitleEl) lTitleEl.textContent = title;
      const lDesc = document.getElementById('light-hero-desc');
      if (lDesc) lDesc.textContent = desc;
      const lScore = document.getElementById('light-hero-score');
      if (lScore) lScore.textContent = `★ ${score}% Score`;
      const lMeta = document.getElementById('light-hero-meta');
      if (lMeta) lMeta.textContent = `${format} • ${eps}`;

      const lBtnAdd = document.getElementById('light-hero-btn-add');
      if (lBtnAdd) {
        lBtnAdd.onclick = () => quickAddWatching(heroMedia.id, title);
      }
      const lBtnInsp = document.getElementById('light-hero-btn-inspect');
      if (lBtnInsp) {
        lBtnInsp.onclick = () => openMediaDetail(heroMedia.id);
      }
    }

    // Render Dark Discover Grid
    const darkGrid = document.getElementById('dark-discover-grid');
    if (darkGrid) {
      if (list.length === 0) {
        darkGrid.innerHTML = `
          <div class="col-span-full py-16 text-center text-slate-400 font-mono text-xs">
            <i class="fa-solid fa-magnifying-glass text-2xl text-cyan-400/50 mb-2"></i>
            <p>No titles matched the current filter criteria.</p>
          </div>
        `;
      } else {
        darkGrid.innerHTML = list.map((m, idx) => {
          const title = getAnimeTitle(m);
          const cover = getCoverImage(m);
          const score = m.averageScore || m.meanScore || '—';
          const format = m.format || 'TV';
          const eps = m.episodes ? `${m.episodes} eps` : 'Airing';
          const nextAiring = m.nextAiringEpisode
            ? `Ep ${m.nextAiringEpisode.episode} ${formatRelativeTime(m.nextAiringEpisode.timeUntilAiring)}`
            : null;

          return `
            <div class="group cursor-pointer bg-[#0d1322] hover:bg-[#131b2e] hud-border hover:border-cyan-500/50 rounded-xl overflow-hidden transition-all duration-200 flex flex-col justify-between relative shadow-md hover:-translate-y-1" onclick="openMediaDetail(${m.id})">
              <div class="relative aspect-[3/4.2] w-full overflow-hidden bg-[#090d16]">
                <img src="${cover}" alt="${title}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
                <div class="absolute inset-0 bg-gradient-to-t from-[#090d16] via-transparent to-transparent opacity-80 group-hover:opacity-40 transition-opacity"></div>
                
                <!-- Format Pill -->
                <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-[#090d16]/90 border border-cyan-500/30 text-cyan-300 font-mono text-[10px] font-bold shadow-sm">
                  ${format}
                </div>

                <!-- Score Badge -->
                <div class="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-[#090d16]/90 border border-amber-500/30 text-amber-400 font-mono text-[10px] font-bold flex items-center gap-1 shadow-sm">
                  ★ ${score}%
                </div>

                ${nextAiring ? `
                  <div class="absolute bottom-2 left-2 right-2 px-2 py-0.5 rounded bg-[#090d16]/90 border border-cyan-500/30 text-cyan-300 text-[10px] font-mono truncate shadow-sm flex items-center gap-1">
                    <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping shrink-0"></span>
                    <span class="truncate">${nextAiring}</span>
                  </div>
                ` : ''}

                <!-- Quick Action Overlay on Hover -->
                <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-2" onclick="event.stopPropagation()">
                  <button onclick="quickNyaaSearch(${m.id}, '${title.replace(/'/g, "\\'")}')" class="p-2 rounded-lg bg-cyan-500 text-obsidian-950 hover:bg-cyan-400 transition-all font-bold text-xs shadow-lg" title="Search Torrents">
                    <i class="fa-solid fa-download"></i>
                  </button>
                  <button onclick="openMediaDetail(${m.id})" class="p-2 rounded-lg bg-slate-800 text-white hover:bg-slate-700 transition-all text-xs border border-slate-600" title="Inspect Media">
                    <i class="fa-solid fa-eye"></i>
                  </button>
                </div>
              </div>

              <!-- Metadata Info Strip -->
              <div class="p-2.5 flex flex-col gap-1">
                <h4 class="font-bold text-xs text-slate-100 line-clamp-1 group-hover:text-cyan-400 transition-colors" title="${title}">${title}</h4>
                <div class="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>${eps}</span>
                  <span>${m.seasonYear || '2026'}</span>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // Render Light Discover Grid
    const lightGrid = document.getElementById('light-discover-grid');
    if (lightGrid) {
      if (list.length === 0) {
        lightGrid.innerHTML = `
          <div class="col-span-full py-16 text-center text-slate-400 font-mono text-xs">
            <i class="fa-solid fa-magnifying-glass text-2xl text-rose-400 mb-2"></i>
            <p>No records matched your filter selection.</p>
          </div>
        `;
      } else {
        lightGrid.innerHTML = list.map((m, idx) => {
          const title = getAnimeTitle(m);
          const cover = getCoverImage(m);
          const score = m.averageScore || m.meanScore || '—';
          const format = m.format || 'TV';
          const eps = m.episodes ? `${m.episodes} eps` : 'Airing';
          const nextAiring = m.nextAiringEpisode
            ? `Ep ${m.nextAiringEpisode.episode} ${formatRelativeTime(m.nextAiringEpisode.timeUntilAiring)}`
            : null;

          return `
            <div class="group cursor-pointer bg-white hover:bg-white/90 hairline-border hover:border-editorial-slate400 rounded-xl overflow-hidden transition-all duration-200 flex flex-col justify-between relative card-shadow hover:-translate-y-0.5" onclick="openMediaDetail(${m.id})">
              <div class="relative aspect-[3/4.2] w-full overflow-hidden bg-slate-100">
                <img src="${cover}" alt="${title}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
                <div class="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-transparent to-transparent opacity-60 group-hover:opacity-30 transition-opacity"></div>
                
                <!-- Format Pill -->
                <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-white/95 text-editorial-slate900 border border-editorial-slate200 font-mono text-[10px] font-bold shadow-sm">
                  ${format}
                </div>

                <!-- Score Badge -->
                <div class="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-white/95 text-editorial-crimson border border-rose-200 font-mono text-[10px] font-bold shadow-sm">
                  ★ ${score}%
                </div>

                ${nextAiring ? `
                  <div class="absolute bottom-2 left-2 right-2 px-2 py-0.5 rounded bg-white/95 text-editorial-slate800 border border-editorial-slate200 text-[10px] font-mono truncate shadow-sm flex items-center gap-1">
                    <span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0"></span>
                    <span class="truncate">${nextAiring}</span>
                  </div>
                ` : ''}

                <!-- Quick Action Overlay on Hover -->
                <div class="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-2" onclick="event.stopPropagation()">
                  <button onclick="quickNyaaSearch(${m.id}, '${title.replace(/'/g, "\\'")}')" class="p-2 rounded-lg bg-editorial-crimson text-white hover:bg-editorial-crimsonDark transition-all font-bold text-xs shadow-lg" title="Search Torrents">
                    <i class="fa-solid fa-download"></i>
                  </button>
                  <button onclick="openMediaDetail(${m.id})" class="p-2 rounded-lg bg-white text-editorial-slate900 hover:bg-slate-100 transition-all text-xs shadow" title="Inspect Media">
                    <i class="fa-solid fa-eye"></i>
                  </button>
                </div>
              </div>

              <!-- Metadata Strip -->
              <div class="p-2.5 flex flex-col gap-1">
                <h4 class="font-bold text-xs text-editorial-slate900 line-clamp-1 group-hover:text-editorial-crimson transition-colors" title="${title}">${title}</h4>
                <div class="flex items-center justify-between text-[10px] text-editorial-slate500 font-mono">
                  <span>${eps}</span>
                  <span>${m.seasonYear || '2026'}</span>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }

  // Render Airing Radar Timeline
  function renderAiringRadar() {
    const schedules = state.airingRadar.length > 0 ? state.airingRadar : FALLBACK_DATA.trending;

    // Dark Radar
    const darkRadar = document.getElementById('dark-airing-radar');
    if (darkRadar) {
      darkRadar.innerHTML = schedules.slice(0, 10).map(item => {
        const m = item.media || item;
        const title = getAnimeTitle(m);
        const cover = getCoverImage(m);
        const ep = item.episode || (m.nextAiringEpisode ? m.nextAiringEpisode.episode : 8);
        const countdown = formatRelativeTime(item.timeUntilAiring !== undefined ? item.timeUntilAiring : 18000);

        return `
          <div class="p-2.5 rounded-xl bg-[#111827] hover:bg-[#18233a] hud-border hover:border-cyan-500/40 transition-colors flex items-center justify-between gap-3 group cursor-pointer" onclick="openMediaDetail(${m.id})">
            <div class="flex items-center gap-2.5 min-w-0">
              <img src="${cover}" alt="${title}" class="w-9 h-12 rounded-lg object-cover flex-shrink-0 bg-[#090d16] hud-border">
              <div class="flex flex-col min-w-0">
                <span class="text-xs font-semibold text-slate-200 truncate group-hover:text-cyan-300 transition-colors">${title}</span>
                <span class="text-[11px] font-mono text-slate-400">Episode ${ep}</span>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/20 text-cyan-300">${countdown}</span>
              <button onclick="event.stopPropagation(); quickAddWatching(${m.id}, '${title.replace(/'/g, "\\'")}')" class="px-2 py-1 rounded bg-[#1c2742] hover:bg-cyan-500 hover:text-obsidian-950 text-slate-300 text-[10px] font-mono transition-colors" title="Sync Tracking">+ AutoSync</button>
            </div>
          </div>
        `;
      }).join('');
    }

    // Light Radar
    const lightRadar = document.getElementById('light-airing-radar');
    if (lightRadar) {
      lightRadar.innerHTML = schedules.slice(0, 10).map(item => {
        const m = item.media || item;
        const title = getAnimeTitle(m);
        const cover = getCoverImage(m);
        const ep = item.episode || (m.nextAiringEpisode ? m.nextAiringEpisode.episode : 8);
        const countdown = formatRelativeTime(item.timeUntilAiring !== undefined ? item.timeUntilAiring : 18000);

        return `
          <div class="p-2.5 rounded-xl bg-editorial-slate100 hover:bg-editorial-slate200/80 border border-editorial-slate200 transition-colors flex items-center justify-between gap-2.5 group cursor-pointer" onclick="openMediaDetail(${m.id})">
            <div class="flex items-center gap-2.5 min-w-0">
              <img src="${cover}" alt="${title}" class="w-9 h-12 rounded-md object-cover flex-shrink-0 bg-white border border-editorial-slate200">
              <div class="flex flex-col min-w-0">
                <span class="text-xs font-semibold text-editorial-slate900 truncate group-hover:text-editorial-crimson transition-colors">${title}</span>
                <span class="text-[10px] font-mono text-editorial-slate500">Episode ${ep}</span>
              </div>
            </div>
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-white border border-editorial-slate200 text-editorial-crimson font-bold">${countdown}</span>
              <button onclick="event.stopPropagation(); quickAddWatching(${m.id}, '${title.replace(/'/g, "\\'")}')" class="px-2 py-1 rounded bg-editorial-slate900 text-white hover:bg-editorial-crimson text-[10px] font-mono transition-colors" title="Sync Tracking">+ AutoSync</button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Render Seasonal Chart Hub & Workspace
  function renderSeasonalChart() {
    let items = state.seasonalChart.length > 0 ? state.seasonalChart : FALLBACK_DATA.seasonal;

    // Filter by Subtab (Airing, Upcoming, TBA, Archive)
    if (state.discoverChartTab === 'Airing') {
      items = items.filter(m => m.status === 'RELEASING' || !m.status || m.nextAiringEpisode);
    } else if (state.discoverChartTab === 'Upcoming') {
      items = items.filter(m => m.status === 'NOT_YET_RELEASED' || m.seasonYear >= 2026);
    } else if (state.discoverChartTab === 'Archive') {
      items = items.filter(m => m.status === 'FINISHED' || m.seasonYear < 2026);
    }

    // Filter by Hide My List
    if (state.hideOnMyList) {
      items = items.filter(m => {
        const inWatch = state.animeList.some(a => a.id === m.id || a.mediaId === m.id);
        const inList = Boolean(state.listEntriesByMedia[m.id]);
        return !inWatch && !inList;
      });
    }

    if (items.length === 0) {
      items = FALLBACK_DATA.seasonal.slice(0, 10);
    }

    // Dark Seasonal Chart
    const darkChart = document.getElementById('dark-seasonal-chart');
    if (darkChart) {
      darkChart.innerHTML = items.slice(0, 15).map(m => {
        const title = getAnimeTitle(m);
        const cover = getCoverImage(m);
        const score = m.averageScore || m.meanScore || '—';
        const format = m.format || 'TV';
        const eps = m.episodes ? `${m.episodes} eps` : 'TBA';

        return `
          <div class="p-2 rounded-xl bg-[#111827] hover:bg-[#18233a] hud-border flex items-center justify-between gap-2.5 transition-colors group cursor-pointer" onclick="openMediaDetail(${m.id})">
            <div class="flex items-center gap-2.5 min-w-0">
              <img src="${cover}" alt="${title}" class="w-8 h-11 rounded-lg object-cover flex-shrink-0 bg-[#090d16] hud-border">
              <div class="flex flex-col min-w-0">
                <span class="text-xs font-semibold text-slate-200 truncate group-hover:text-cyan-300 transition-colors">${title}</span>
                <span class="text-[10px] font-mono text-slate-400">${format} • ${eps}</span>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <span class="text-[10px] font-mono text-amber-400 font-bold">★ ${score}%</span>
              <button onclick="event.stopPropagation(); quickAddWatching(${m.id}, '${title.replace(/'/g, "\\'")}')" class="p-1 rounded bg-[#1c2742] hover:bg-cyan-500 hover:text-obsidian-950 text-slate-300 text-xs transition-colors" title="Bookmark / Add to List">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    // Light Seasonal Chart
    const lightChart = document.getElementById('light-seasonal-list');
    if (lightChart) {
      lightChart.innerHTML = items.slice(0, 15).map(m => {
        const title = getAnimeTitle(m);
        const cover = getCoverImage(m);
        const score = m.averageScore || m.meanScore || '—';
        const format = m.format || 'TV';
        const eps = m.episodes ? `${m.episodes} eps` : 'TBA';

        return `
          <div class="p-2 rounded-lg bg-editorial-slate50 hover:bg-editorial-slate100 border border-editorial-slate200 flex items-center justify-between gap-2.5 transition-colors group cursor-pointer" onclick="openMediaDetail(${m.id})">
            <div class="flex items-center gap-2.5 min-w-0">
              <img src="${cover}" alt="${title}" class="w-8 h-11 rounded-md object-cover flex-shrink-0 bg-white border border-editorial-slate200">
              <div class="flex flex-col min-w-0">
                <span class="text-xs font-semibold text-editorial-slate900 truncate group-hover:text-editorial-crimson transition-colors">${title}</span>
                <span class="text-[10px] font-mono text-editorial-slate500">${format} • ${eps}</span>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <span class="text-[10px] font-mono text-editorial-crimson font-bold">★ ${score}%</span>
              <button onclick="event.stopPropagation(); quickAddWatching(${m.id}, '${title.replace(/'/g, "\\'")}')" class="p-1 rounded bg-white hover:bg-editorial-slate900 hover:text-white border border-editorial-slate200 text-editorial-slate700 text-xs transition-colors" title="Bookmark / Add to List">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // ==============================================================
  // MEDIA DETAIL ART SHEET MODAL
  // ==============================================================
  window.openMediaDetail = async function (mediaId) {
    if (!mediaId) return;
    state.activeMediaDetailId = mediaId;
    openModal(DOM.mediaDetailModal);
    DOM.mediaDetailContent.innerHTML = `
      <div class="py-24 flex flex-col items-center justify-center text-slate-400">
        <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-cyan-400"></i>
        <p class="text-sm font-semibold">Loading media sheet...</p>
      </div>
    `;

    try {
      const QUERY = `
        query ($id: Int) {
          Media(id: $id, type: ANIME) {
            id
            idMal
            title { romaji english native userPreferred }
            coverImage { extraLarge large medium color }
            bannerImage
            format
            status
            episodes
            duration
            season
            seasonYear
            averageScore
            meanScore
            popularity
            favourites
            source
            genres
            synonyms
            description(asHtml: false)
            studios(isMain: true) { nodes { name } }
            startDate { year month day }
            endDate { year month day }
            nextAiringEpisode { episode airingAt timeUntilAiring }
            mediaListEntry {
              id
              status
              score
              progress
              repeat
              notes
            }
          }
        }
      `;
      let media = null;
      try {
        const data = await API.queryAniList(QUERY, { id: parseInt(mediaId) });
        media = data?.Media;
      } catch (e) {}

      if (!media) {
        const res = await fetch(`/api/anilist/media/${mediaId}`);
        if (res.ok) media = await res.json();
      }

      if (!media) {
        const allItems = [...FALLBACK_DATA.trending, ...FALLBACK_DATA.popular, ...FALLBACK_DATA.top, ...FALLBACK_DATA.seasonal];
        media = allItems.find(x => x.id === parseInt(mediaId)) || FALLBACK_DATA.trending[0];
      }

      state.activeMediaDetail = media;

      const title = getAnimeTitle(media);
      const cover = getCoverImage(media);
      const banner = media.bannerImage || cover;
      const score = media.averageScore || media.meanScore || '—';
      const desc = sanitizeHtml(media.description) || 'Rich metadata from AniList GraphQL directory.';
      const studio = media.studios?.nodes?.[0]?.name || 'Animation Studio';
      const genres = (media.genres || ['Action', 'Fantasy']).map(g => `<span class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300">${g}</span>`).join('');
      const listEntry = media.mediaListEntry || state.listEntriesByMedia[media.id];

      DOM.mediaDetailContent.innerHTML = `
        <!-- Banner Header -->
        <div class="relative h-48 sm:h-64 w-full overflow-hidden bg-slate-900">
          <img src="${banner}" alt="Banner" class="w-full h-full object-cover opacity-60">
          <div class="absolute inset-0 bg-gradient-to-t from-[#0d1322] via-[#0d1322]/40 to-transparent"></div>
          <div class="absolute bottom-4 left-4 sm:left-6 flex items-end gap-4 z-10">
            <img src="${cover}" alt="${title}" class="w-20 h-28 sm:w-28 sm:h-40 rounded-2xl object-cover shadow-2xl border-2 border-white/20">
            <div class="flex flex-col gap-1 pb-1">
              <span class="text-xs font-mono text-cyan-400 font-bold uppercase tracking-wider">${media.format || 'TV'} • ${studio}</span>
              <h2 class="text-lg sm:text-2xl font-bold font-display text-white max-w-xl line-clamp-1">${title}</h2>
              <div class="flex items-center gap-3 text-xs text-slate-300 font-mono">
                <span class="text-amber-400 font-bold">★ ${score}% Score</span>
                <span>•</span>
                <span>${media.episodes ? `${media.episodes} Episodes` : 'Releasing'}</span>
                <span>•</span>
                <span>${media.season || ''} ${media.seasonYear || ''}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Body Content -->
        <div class="p-4 sm:p-6 space-y-6">
          <!-- Action Buttons Bar -->
          <div class="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-[#111827] border border-slate-200 dark:border-slate-800">
            <div class="flex items-center gap-2">
              <button onclick="openListEditor(${media.id})" class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-obsidian-950 font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-2">
                <i class="fa-solid fa-list-check"></i>
                <span>${listEntry ? `Status: ${listEntry.status}` : '+ Add to AniList'}</span>
              </button>
              <button onclick="quickNyaaSearch(${media.id}, '${title.replace(/'/g, "\\'")}')" class="px-4 py-2 bg-pink-500 hover:bg-pink-400 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-2">
                <i class="fa-solid fa-download"></i>
                <span>Search Torrents</span>
              </button>
            </div>
            <a href="https://anilist.co/anime/${media.id}" target="_blank" rel="noopener" class="text-xs font-mono text-slate-400 hover:text-cyan-400 transition-colors flex items-center gap-1.5">
              <span>View on AniList</span>
              <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
            </a>
          </div>

          <!-- Genres -->
          <div class="flex flex-wrap gap-1.5">
            ${genres}
          </div>

          <!-- Synopsis -->
          <div class="space-y-2">
            <h3 class="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">Synopsis</h3>
            <p class="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed max-h-60 overflow-y-auto custom-scrollbar pr-2">${desc}</p>
          </div>
        </div>
      `;
    } catch (err) {
      DOM.mediaDetailContent.innerHTML = `
        <div class="p-8 text-center text-rose-500">
          <i class="fa-solid fa-circle-exclamation text-3xl mb-3"></i>
          <p class="text-sm font-semibold">${err.message}</p>
        </div>
      `;
    }
  };

  // ==============================================================
  // WATCHING PANEL CONTROLLER
  // ==============================================================
  async function loadWatching() {
    const grid = document.getElementById('anime-grid');
    if (!grid) return;

    try {
      const anime = await API.getAnimeList();
      state.animeList = anime || [];

      // Update badge count
      const count = state.animeList.length;
      const darkBadge = document.getElementById('dark-watching-badge');
      if (darkBadge) darkBadge.textContent = count;
      const lightBadge = document.getElementById('light-watching-badge');
      if (lightBadge) lightBadge.textContent = count;

      if (state.animeList.length === 0) {
        grid.innerHTML = `
          <div class="col-span-full py-16 text-center text-slate-400 font-mono text-xs">
            <i class="fa-solid fa-tv text-3xl text-cyan-400/50 mb-3"></i>
            <p>No anime currently tracked in Watching cockpit.</p>
            <button onclick="switchTab('discover')" class="mt-4 px-4 py-2 bg-cyan-500 text-obsidian-950 rounded-xl text-xs font-bold">Discover Anime</button>
          </div>
        `;
        return;
      }

      grid.innerHTML = state.animeList.map(a => {
        const title = a.name || a.title || 'Untitled';
        const cover = a.image || a.coverImage || SVG_PLACEHOLDER;
        const ep = a.episode || 0;
        const totalEp = a.totalEpisodes || '?';
        const id = a.id || a.mediaId;

        return `
          <div class="rounded-2xl border border-slate-200/60 dark:border-[#1c2742] bg-white dark:bg-[#0d1322] overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
            <div class="p-4 flex gap-4">
              <img src="${cover}" alt="${title}" class="w-16 h-24 rounded-xl object-cover flex-shrink-0 bg-slate-900 border border-slate-700/50">
              <div class="flex flex-col justify-between min-w-0">
                <div>
                  <h3 class="font-bold text-sm text-slate-900 dark:text-white truncate cursor-pointer hover:text-cyan-400 transition-colors" onclick="openMediaDetail(${id})">${title}</h3>
                  <span class="text-xs font-mono text-slate-400">Progress: ${ep} / ${totalEp}</span>
                </div>
                <div class="flex items-center gap-2 pt-2">
                  <button onclick="quickNyaaSearch(${id}, '${title.replace(/'/g, "\\'")}')" class="px-3 py-1 bg-cyan-500/10 hover:bg-cyan-500 border border-cyan-500/20 text-cyan-400 hover:text-obsidian-950 font-semibold text-xs rounded-lg transition-colors cursor-pointer">
                    <i class="fa-solid fa-download mr-1"></i>Torrents
                  </button>
                  <button onclick="openListEditor(${id})" class="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-white rounded-lg text-xs transition-colors cursor-pointer">
                    <i class="fa-solid fa-pen"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      grid.innerHTML = `<div class="col-span-full py-12 text-center text-rose-500 text-xs">${err.message}</div>`;
    }
  }

  // ==============================================================
  // LISTS PANEL CONTROLLER
  // ==============================================================
  async function loadUserListsData() {
    const container = document.getElementById('lists-entries-container');
    if (!container) return;
    container.innerHTML = `<div class="py-16 text-center text-slate-400 text-sm"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading collection...</div>`;

    try {
      const type = state.listsMediaType || 'ANIME';
      const res = await fetch(`/api/anilist/user-list?userName=${encodeURIComponent(state.userName || '')}&type=${type}&perChunk=500`);
      if (!res.ok) throw new Error('Failed to load user lists from AniList');
      const data = await res.json();
      state.userListsData = data;

      // Flatten entries and calculate counts
      const lists = data.lists || [];
      let allEntries = [];
      const counts = { ALL: 0, CURRENT: 0, REPEATING: 0, COMPLETED: 0, PAUSED: 0, DROPPED: 0, PLANNING: 0 };

      lists.forEach(l => {
        (l.entries || []).forEach(entry => {
          allEntries.push(entry);
          counts.ALL++;
          if (entry.status && counts[entry.status] !== undefined) {
            counts[entry.status]++;
          }
          if (entry.mediaId) {
            state.listEntriesByMedia[entry.mediaId] = entry;
          }
        });
      });

      // Update count tags
      ['all', 'current', 'repeating', 'completed', 'paused', 'dropped', 'planning'].forEach(k => {
        const el = document.getElementById(`cnt-${k}`);
        if (el) el.textContent = counts[k.toUpperCase()] || 0;
      });

      renderListEntries(allEntries);
    } catch (err) {
      container.innerHTML = `<div class="py-12 text-center text-rose-500 text-xs">${err.message}</div>`;
    }
  }

  function renderListEntries(entries) {
    const container = document.getElementById('lists-entries-container');
    if (!container) return;

    let filtered = entries;
    if (state.listsStatusGroup !== 'ALL') {
      filtered = filtered.filter(e => e.status === state.listsStatusGroup);
    }
    if (state.listsSearch) {
      filtered = filtered.filter(e => {
        const title = getAnimeTitle(e.media || e).toLowerCase();
        return title.includes(state.listsSearch.toLowerCase());
      });
    }

    if (filtered.length === 0) {
      container.innerHTML = `<div class="py-16 text-center text-slate-400 text-xs font-mono">No entries matched the selected filter.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
        ${filtered.map(entry => {
          const m = entry.media || entry;
          const title = getAnimeTitle(m);
          const cover = getCoverImage(m);
          const score = entry.score || '—';
          const prog = entry.progress || 0;
          const total = m.episodes || '?';

          return `
            <div class="group cursor-pointer bg-[#0d1322] hover:bg-[#131b2e] hud-border rounded-xl overflow-hidden transition-all flex flex-col justify-between" onclick="openMediaDetail(${m.id || entry.mediaId})">
              <div class="relative aspect-[3/4] bg-slate-900 overflow-hidden">
                <img src="${cover}" alt="${title}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
                <div class="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 font-mono text-[10px] text-amber-400 font-bold">★ ${score}</div>
                <div class="absolute bottom-1.5 left-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 font-mono text-[10px] text-cyan-300 truncate">${prog} / ${total} eps</div>
              </div>
              <div class="p-2">
                <h4 class="font-bold text-xs text-slate-200 line-clamp-1 group-hover:text-cyan-400" title="${title}">${title}</h4>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Lists Status Filter Tabs
  document.querySelectorAll('.list-status-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.list-status-tab').forEach(t => {
        t.className = 'list-status-tab px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-white shrink-0 cursor-pointer';
      });
      tab.className = 'list-status-tab px-4 py-2 rounded-xl bg-cyan-500 text-obsidian-950 shadow-sm shrink-0 cursor-pointer';
      state.listsStatusGroup = tab.dataset.statusGroup || 'ALL';
      if (state.userListsData) {
        let allEntries = [];
        (state.userListsData.lists || []).forEach(l => {
          (l.entries || []).forEach(e => allEntries.push(e));
        });
        renderListEntries(allEntries);
      }
    });
  });

  // Lists Search Filter
  document.getElementById('lists-search-input')?.addEventListener('input', (e) => {
    state.listsSearch = e.target.value.trim();
    if (state.userListsData) {
      let allEntries = [];
      (state.userListsData.lists || []).forEach(l => {
        (l.entries || []).forEach(e => allEntries.push(e));
      });
      renderListEntries(allEntries);
    }
  });

  // ==============================================================
  // GLOBAL SEARCH CONTROLLER
  // ==============================================================
  async function performSearch() {
    const grid = document.getElementById('search-results-grid');
    if (!grid) return;
    grid.innerHTML = `<div class="col-span-full py-16 text-center text-slate-400 text-sm"><i class="fa-solid fa-spinner fa-spin mr-2 text-cyan-400"></i>Executing search...</div>`;

    const term = state.searchQuery || document.getElementById('global-search-input')?.value.trim();
    const entity = state.searchEntity || 'ANIME';

    try {
      const QUERY = `
        query ($search: String, $type: MediaType, $page: Int, $perPage: Int) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { hasNextPage }
            media(search: $search, type: $type, isAdult: false) {
              id
              title { romaji english native userPreferred }
              coverImage { large medium color }
              format
              episodes
              averageScore
              status
            }
          }
        }
      `;
      let items = [];
      try {
        const data = await API.queryAniList(QUERY, { search: term || undefined, type: entity === 'MANGA' ? 'MANGA' : 'ANIME', page: 1, perPage: 20 });
        items = data?.Page?.media || [];
      } catch (e) {}

      if (items.length === 0) {
        const res = await fetch(`/api/anilist/search?query=${encodeURIComponent(term || '')}&type=${entity === 'MANGA' ? 'MANGA' : 'ANIME'}`);
        if (res.ok) {
          const json = await res.json();
          items = json.media || json.results || [];
        }
      }

      if (items.length === 0) {
        items = FALLBACK_DATA.trending.slice(0, 10);
      }

      state.searchResults = items;

      grid.innerHTML = items.map(m => {
        const title = getAnimeTitle(m);
        const cover = getCoverImage(m);
        const score = m.averageScore || '—';
        const format = m.format || 'TV';

        return `
          <div class="group cursor-pointer bg-[#0d1322] hover:bg-[#131b2e] hud-border rounded-xl overflow-hidden transition-all flex flex-col justify-between shadow-md" onclick="openMediaDetail(${m.id})">
            <div class="relative aspect-[3/4] bg-[#090d16] overflow-hidden">
              <img src="${cover}" alt="${title}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
              <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/80 text-cyan-300 font-mono text-[10px] font-bold">${format}</div>
              <div class="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-amber-400 font-mono text-[10px] font-bold">★ ${score}%</div>
            </div>
            <div class="p-2.5">
              <h4 class="font-bold text-xs text-slate-200 line-clamp-1 group-hover:text-cyan-400">${title}</h4>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      grid.innerHTML = `<div class="col-span-full py-12 text-center text-rose-500 text-xs">${err.message}</div>`;
    }
  }

  // Filter drawer toggle in Search
  document.getElementById('btn-toggle-filters')?.addEventListener('click', () => {
    document.getElementById('search-filter-drawer')?.classList.toggle('hidden');
  });

  // Search Entity Tabs
  document.querySelectorAll('.search-entity-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.search-entity-tab').forEach(t => {
        t.className = 'search-entity-tab px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-white shrink-0 cursor-pointer';
      });
      tab.className = 'search-entity-tab px-4 py-2 rounded-xl bg-cyan-500 text-obsidian-950 shadow-sm shrink-0 cursor-pointer';
      state.searchEntity = tab.dataset.entityTab || 'ANIME';
      performSearch();
    });
  });

  // ==============================================================
  // SOCIAL PANEL CONTROLLER
  // ==============================================================
  async function loadSocialFeed() {
    const list = document.getElementById('activity-feed-list');
    if (!list) return;
    list.innerHTML = `<div class="py-12 text-center text-slate-400 text-xs"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading activity feed...</div>`;

    try {
      const QUERY = `
        query {
          Page(page: 1, perPage: 15) {
            activities(isFollowing: true, type_in: [TEXT, ANIME_LIST]) {
              ... on TextActivity {
                id
                text
                createdAt
                user { name avatar { medium } }
              }
              ... on ListActivity {
                id
                type
                status
                progress
                createdAt
                user { name avatar { medium } }
                media { id title { romaji userPreferred } coverImage { medium } }
              }
            }
          }
        }
      `;
      let acts = [];
      try {
        const data = await API.queryAniList(QUERY);
        acts = data?.Page?.activities || [];
      } catch (e) {}

      if (acts.length === 0) {
        const res = await fetch('/api/anilist/activity');
        if (res.ok) {
          const json = await res.json();
          acts = json.activities || [];
        }
      }

      if (acts.length === 0) {
        list.innerHTML = `<div class="py-8 text-center text-slate-400 text-xs font-mono">No recent activity from followed users.</div>`;
        return;
      }

      list.innerHTML = acts.map(a => {
        const u = a.user || { name: 'User', avatar: { medium: SVG_PLACEHOLDER } };
        const isList = Boolean(a.media);
        const text = isList ? `${a.status || 'Updated'} ${a.progress ? `episode ${a.progress} of` : ''} ${getAnimeTitle(a.media)}` : sanitizeHtml(a.text);

        return `
          <div class="p-4 rounded-2xl bg-slate-50 dark:bg-[#111827] border border-slate-200/60 dark:border-slate-800 flex items-start gap-3.5">
            <img src="${u.avatar?.medium || SVG_PLACEHOLDER}" alt="${u.name}" class="w-10 h-10 rounded-xl object-cover flex-shrink-0">
            <div class="flex-grow space-y-1 min-w-0">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-slate-900 dark:text-white">${u.name}</span>
                <span class="text-[10px] font-mono text-slate-400">Activity</span>
              </div>
              <p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">${text}</p>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      list.innerHTML = `<div class="py-8 text-center text-rose-500 text-xs">${err.message}</div>`;
    }
  }

  // ==============================================================
  // STATS PANEL CONTROLLER
  // ==============================================================
  async function loadUserStats() {
    try {
      const QUERY = `
        query ($name: String) {
          User(name: $name) {
            statistics {
              anime {
                count
                meanScore
                minutesWatched
                episodesWatched
                genres(limit: 6, sort: COUNT_DESC) { genre count }
                formats(limit: 4, sort: COUNT_DESC) { format count }
              }
            }
          }
        }
      `;
      let stats = null;
      try {
        const data = await API.queryAniList(QUERY, { name: state.userName || undefined });
        stats = data?.User?.statistics?.anime;
      } catch (e) {}

      if (!stats) {
        const res = await fetch(`/api/anilist/user/${state.userName || 'viewer'}`);
        if (res.ok) {
          const json = await res.json();
          stats = json.statistics?.anime;
        }
      }

      if (!stats) return;

      document.getElementById('stat-total-anime').textContent = stats.count || 0;
      document.getElementById('stat-days-watched').textContent = (stats.minutesWatched ? (stats.minutesWatched / 1440).toFixed(1) : '0.0');
      document.getElementById('stat-mean-score').textContent = stats.meanScore || '0.0';
      document.getElementById('stat-total-episodes').textContent = stats.episodesWatched || 0;

      const genreBox = document.getElementById('chart-genre-container');
      if (genreBox && stats.genres) {
        genreBox.innerHTML = stats.genres.map(g => `
          <div class="space-y-1">
            <div class="flex justify-between text-xs font-semibold">
              <span>${g.genre}</span>
              <span class="font-mono text-cyan-400">${g.count}</span>
            </div>
            <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div class="h-full bg-cyan-500 rounded-full" style="width: ${Math.min(100, (g.count / stats.count) * 100)}%"></div>
            </div>
          </div>
        `).join('');
      }

      const formatBox = document.getElementById('chart-format-container');
      if (formatBox && stats.formats) {
        formatBox.innerHTML = stats.formats.map(f => `
          <div class="space-y-1">
            <div class="flex justify-between text-xs font-semibold">
              <span>${f.format}</span>
              <span class="font-mono text-pink-400">${f.count}</span>
            </div>
            <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div class="h-full bg-pink-500 rounded-full" style="width: ${Math.min(100, (f.count / stats.count) * 100)}%"></div>
            </div>
          </div>
        `).join('');
      }
    } catch (err) {
      console.warn('Stats query failed:', err);
    }
  }

  // ==============================================================
  // HISTORY & LOGS PANEL CONTROLLERS
  // ==============================================================
  async function loadDownloadHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;
    list.innerHTML = `<div class="py-12 text-center text-slate-400 text-xs"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading history...</div>`;

    try {
      const history = await API.getDownloadHistory();
      if (!history || history.length === 0) {
        list.innerHTML = `<div class="py-12 text-center text-slate-400 text-xs font-mono">No previous download history recorded.</div>`;
        return;
      }

      list.innerHTML = history.map(h => `
        <div class="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs">
          <div class="flex items-center gap-3 min-w-0">
            <i class="fa-solid fa-cloud-arrow-down text-cyan-400 text-base"></i>
            <div class="flex flex-col min-w-0">
              <span class="font-bold text-slate-800 dark:text-slate-100 truncate">${h.title || h.name || 'Episode Download'}</span>
              <span class="text-[10px] font-mono text-slate-400">${h.timestamp ? new Date(h.timestamp * 1000).toLocaleString() : 'Completed'}</span>
            </div>
          </div>
          <span class="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono text-[10px] font-bold">COMPLETED</span>
        </div>
      `).join('');
    } catch (err) {
      list.innerHTML = `<div class="py-8 text-center text-rose-500 text-xs">${err.message}</div>`;
    }
  }

  document.getElementById('history-refresh-btn')?.addEventListener('click', loadDownloadHistory);
  document.getElementById('history-clear-btn')?.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear your download history?')) return;
    try {
      await API.clearHistory();
      showToast('Download history cleared', 'success');
      loadDownloadHistory();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  async function loadLogs() {
    const logsBody = document.getElementById('logs-body');
    if (!logsBody) return;
    try {
      const logName = document.getElementById('log-select')?.value || 'combined';
      const lines = document.getElementById('log-lines')?.value || 250;
      const data = await API.getLogs(logName, lines);
      logsBody.textContent = data.logs || data.content || 'No logs found.';
      logsBody.scrollTop = logsBody.scrollHeight;
    } catch (err) {
      logsBody.textContent = `Error loading logs: ${err.message}`;
    }
  }
  document.getElementById('log-refresh-btn')?.addEventListener('click', loadLogs);

  // ==============================================================
  // SETTINGS PANEL CONTROLLER
  // ==============================================================
  async function loadSettingsConfig() {
    try {
      const config = await API.getConfig();
      if (!config) return;

      const form = document.getElementById('profile-config-form');
      if (form) {
        Object.keys(config).forEach(key => {
          const input = form.querySelector(`[name="${key}"]`);
          if (input) {
            if (input.type === 'checkbox') {
              input.checked = Boolean(config[key]);
            } else {
              input.value = config[key] || '';
            }
          }
        });
      }

      state.userName = config.aniUserName || '';
      state.userId = config.id || null;
      state.titleLang = config.titleLanguage || 'romaji';

      const userTag = document.getElementById('user-display-name');
      if (userTag) userTag.textContent = state.userName || 'Otaku';

      // Update OAuth status indicator
      const authIndicator = document.getElementById('auth-status-indicator');
      const authText = document.getElementById('auth-status-text');
      if (config.hasBearerToken || config.bearerTokenAnilist) {
        if (authIndicator) authIndicator.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block shrink-0';
        if (authText) authText.textContent = 'OAuth Status: Connected';
      } else {
        if (authIndicator) authIndicator.className = 'w-2.5 h-2.5 rounded-full bg-slate-400 inline-block shrink-0';
        if (authText) authText.textContent = 'OAuth Status: Offline';
      }
    } catch (err) {
      console.warn('Failed to load settings config:', err);
    }
  }

  document.getElementById('btn-submit-config')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const form = document.getElementById('profile-config-form');
    if (!form) return;

    const formData = new FormData(form);
    const payload = {};
    formData.forEach((val, key) => {
      payload[key] = val;
    });

    try {
      await API.saveConfig(payload);
      showToast('Configuration saved & hotloaded successfully!', 'success');
      loadSettingsConfig();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ==============================================================
  // LIST EDITOR MODAL CONTROLLER
  // ==============================================================
  window.openListEditor = async function (mediaId) {
    if (!mediaId) return;
    openModal(DOM.listEditorModal);
    document.getElementById('editor-media-id').value = mediaId;
    const entry = state.listEntriesByMedia[mediaId];

    if (entry) {
      document.getElementById('editor-status').value = entry.status || 'CURRENT';
      document.getElementById('editor-progress').value = entry.progress || 0;
      document.getElementById('editor-score').value = entry.score || 0;
      document.getElementById('editor-notes').value = entry.notes || '';
      document.getElementById('editor-repeat').value = entry.repeat || 0;
    } else {
      document.getElementById('editor-status').value = 'CURRENT';
      document.getElementById('editor-progress').value = 0;
      document.getElementById('editor-score').value = 0;
      document.getElementById('editor-notes').value = '';
      document.getElementById('editor-repeat').value = 0;
    }
  };

  document.getElementById('btn-progress-inc')?.addEventListener('click', () => {
    const input = document.getElementById('editor-progress');
    if (input) input.value = (parseInt(input.value) || 0) + 1;
  });
  document.getElementById('btn-progress-dec')?.addEventListener('click', () => {
    const input = document.getElementById('editor-progress');
    if (input) input.value = Math.max(0, (parseInt(input.value) || 0) - 1);
  });

  document.getElementById('btn-editor-save')?.addEventListener('click', async () => {
    const mediaId = parseInt(document.getElementById('editor-media-id').value);
    const status = document.getElementById('editor-status').value;
    const progress = parseInt(document.getElementById('editor-progress').value) || 0;
    const score = parseFloat(document.getElementById('editor-score').value) || 0;
    const notes = document.getElementById('editor-notes').value;
    const repeat = parseInt(document.getElementById('editor-repeat').value) || 0;

    try {
      await saveListEntryViaBackend({ mediaId, status, progress, scoreRaw: Math.round(score), notes, repeat });
      showToast('List entry updated successfully!', 'success');
      state.listEntriesByMedia[mediaId] = {
        ...(state.listEntriesByMedia[mediaId] || {}),
        mediaId, status, progress, score, notes, repeat
      };
      closeModal(DOM.listEditorModal);
      if (state.activeTab === 'lists') loadUserListsData();
      if (state.activeTab === 'watching') loadWatching();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ==============================================================
  // NYAA MODAL CONTROLLER
  // ==============================================================
  window.openNyaaModal = async function (mediaId, title) {
    openModal(DOM.nyaaDialog);
    const titleEl = document.getElementById('nyaa-dialog-title');
    if (titleEl) titleEl.textContent = `Search Nyaa.si — ${title || 'Anime'}`;
    const list = document.getElementById('nyaa-candidates-list');
    if (list) {
      list.innerHTML = `<div class="py-12 text-center text-slate-400 text-xs"><i class="fa-solid fa-spinner fa-spin mr-2 text-pink-400"></i>Indexing torrent candidates...</div>`;
    }

    try {
      const data = await API.searchNyaa(mediaId);
      const candidates = data.candidates || data.results || [];

      if (candidates.length === 0) {
        list.innerHTML = `<div class="py-12 text-center text-slate-400 text-xs font-mono">No matching torrents found on Nyaa.si.</div>`;
        return;
      }

      list.innerHTML = candidates.map(c => `
        <div class="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs">
          <div class="flex flex-col min-w-0">
            <span class="font-bold text-slate-800 dark:text-slate-100 truncate">${c.title || c.name}</span>
            <span class="text-[10px] font-mono text-slate-400">${c.size || ''} • Seeders: ${c.seeders || 0}</span>
          </div>
          <button onclick="downloadTorrent(${mediaId}, '${encodeURIComponent(c.link || c.magnet || '')}', ${c.episode || 1})" class="px-3.5 py-1.5 bg-pink-500 hover:bg-pink-400 text-white rounded-xl font-bold shrink-0 transition-colors cursor-pointer">
            Download
          </button>
        </div>
      `).join('');
    } catch (err) {
      if (list) list.innerHTML = `<div class="py-8 text-center text-rose-500 text-xs">${err.message}</div>`;
    }
  };

  window.downloadTorrent = async function (mediaId, encodedLink, episode) {
    try {
      const link = decodeURIComponent(encodedLink);
      showToast('Sending torrent to qBittorrent queue...', 'info');
      await API.downloadNyaa(mediaId, link, episode);
      showToast('Torrent queued successfully in qBittorrent!', 'success');
      closeModal(DOM.nyaaDialog);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ==============================================================
  // MODAL UTILITIES
  // ==============================================================
  function openModal(modal) {
    if (!modal) return;
    modal.classList.remove('opacity-0', 'pointer-events-none');
    const inner = modal.querySelector('.scale-95');
    if (inner) inner.classList.remove('scale-95');
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.add('opacity-0', 'pointer-events-none');
    const inner = modal.querySelector('.transform, .scale-95');
    if (inner) inner.classList.add('scale-95');
  }

  document.querySelectorAll('[data-close], .dialog-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = btn.closest('#media-detail-modal, #list-editor-modal, #settings-dialog, #nyaa-dialog');
      if (modal) closeModal(modal);
    });
  });

  // ==============================================================
  // NOTIFICATION SYSTEM
  // ==============================================================
  function setupNotifications() {
    const toggleBtns = document.querySelectorAll('.notif-toggle-btn');
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isDark = document.documentElement.classList.contains('dark');
        const panel = isDark ? DOM.notifDropdownDark : DOM.notifDropdownLight;
        panel?.classList.toggle('hidden');
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.notif-toggle-btn, .notif-dropdown-panel')) {
        DOM.notifDropdownDark?.classList.add('hidden');
        DOM.notifDropdownLight?.classList.add('hidden');
      }
    });

    document.querySelectorAll('.btn-mark-all-read').forEach(btn => {
      btn.addEventListener('click', () => {
        state.unreadNotifications = 0;
        document.querySelectorAll('.notif-badge-shared').forEach(b => b.classList.add('hidden'));
        document.querySelectorAll('.notif-list-container').forEach(c => {
          c.innerHTML = `<p class="text-slate-400 text-center py-6">No new notifications</p>`;
        });
      });
    });
  }

  // ==============================================================
  // INITIALIZATION ON DOM READY
  // ==============================================================
  document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    setupNotifications();
    await loadSettingsConfig();
    switchTab('discover');
  });

})();
