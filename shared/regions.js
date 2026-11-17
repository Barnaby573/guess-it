// shared/regions.js
//
// The regions a player can choose in the map games (Capital Drop and
// Learn Countries). Every one of the 195 countries belongs to exactly one
// region, so playing all the regions covers the whole world once.
//
// Countries are listed by their 2-letter ISO code. To move a country,
// cut its code from one list and paste it into another.

const REGION_LIST = [
  {
    key: 'western-europe',
    label: 'Western Europe',
    emoji: '🗼',
    codes: [
      'GB', 'IE', 'FR', 'ES', 'PT', 'AD', 'MC', 'BE', 'NL', 'LU', 'DE',
      'CH', 'AT', 'LI', 'IT', 'SM', 'MT', 'DK', 'NO', 'SE', 'FI', 'IS',
    ],
  },
  {
    key: 'eastern-europe',
    label: 'Eastern Europe',
    emoji: '🏰',
    codes: [
      'PL', 'CZ', 'SK', 'HU', 'SI', 'HR', 'BA', 'RS', 'ME', 'XK', 'AL',
      'MK', 'GR', 'BG', 'RO', 'MD', 'UA', 'BY', 'LT', 'LV', 'EE', 'RU', 'CY',
    ],
  },
  {
    key: 'middle-east',
    label: 'Middle East & North Africa',
    emoji: '🕌',
    codes: [
      'TR', 'SY', 'LB', 'IL', 'PS', 'JO', 'IQ', 'IR', 'SA', 'KW', 'BH',
      'QA', 'AE', 'OM', 'YE', 'GE', 'AM', 'AZ',
      'MA', 'DZ', 'TN', 'LY', 'EG', 'SD',
    ],
  },
  {
    key: 'west-africa',
    label: 'West Africa',
    emoji: '🥁',
    codes: [
      'MR', 'SN', 'GM', 'GW', 'GN', 'SL', 'LR', 'CI', 'GH', 'TG', 'BJ',
      'NG', 'NE', 'ML', 'BF', 'CV',
    ],
  },
  {
    key: 'east-africa',
    label: 'East Africa',
    emoji: '🦒',
    codes: [
      'ER', 'DJ', 'ET', 'SO', 'SS', 'KE', 'UG', 'RW', 'BI', 'TZ', 'SC',
      'KM', 'MG', 'MU',
    ],
  },
  {
    key: 'southern-africa',
    label: 'Middle & Southern Africa',
    emoji: '🦁',
    codes: [
      'TD', 'CF', 'CM', 'GQ', 'GA', 'CG', 'CD', 'ST', 'AO', 'ZM', 'MW',
      'MZ', 'ZW', 'BW', 'NA', 'ZA', 'LS', 'SZ',
    ],
  },
  {
    key: 'south-asia',
    label: 'Central & South Asia',
    emoji: '🏔️',
    codes: [
      'KZ', 'UZ', 'TM', 'KG', 'TJ', 'AF', 'PK', 'IN', 'NP', 'BT', 'BD',
      'LK', 'MV',
    ],
  },
  {
    key: 'east-asia',
    label: 'East & Southeast Asia',
    emoji: '🏯',
    codes: [
      'CN', 'MN', 'KP', 'KR', 'JP', 'MM', 'TH', 'LA', 'KH', 'VN', 'MY',
      'SG', 'BN', 'ID', 'PH', 'TL',
    ],
  },
  {
    key: 'oceania',
    label: 'Oceania',
    emoji: '🏝️',
    codes: [
      'AU', 'NZ', 'PG', 'FJ', 'SB', 'VU', 'WS', 'TO', 'KI', 'TV', 'NR',
      'PW', 'FM', 'MH',
    ],
  },
  {
    key: 'north-america',
    label: 'North America & Caribbean',
    emoji: '🗽',
    codes: [
      'CA', 'US', 'MX', 'GT', 'BZ', 'SV', 'HN', 'NI', 'CR', 'PA', 'CU',
      'JM', 'HT', 'DO', 'BS', 'BB', 'TT', 'GD', 'LC', 'VC', 'AG', 'DM', 'KN',
    ],
  },
  {
    key: 'south-america',
    label: 'South America',
    emoji: '🦜',
    codes: [
      'CO', 'VE', 'GY', 'SR', 'EC', 'PE', 'BR', 'BO', 'PY', 'CL', 'AR', 'UY',
    ],
  },
];

// "Whole world" is simply every region's countries joined together.
// flatMap takes the list from each region and merges them into one list.
const WHOLE_WORLD = {
  key: 'world',
  label: 'Whole world',
  emoji: '🌍',
  codes: REGION_LIST.flatMap((region) => region.codes),
};

// The full list offered to the player, with Whole world first.
export const REGIONS = [WHOLE_WORLD, ...REGION_LIST];
