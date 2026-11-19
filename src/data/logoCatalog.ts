import { t } from '../i18n/translations';

export interface LogoDefinition {
  id: string;
  label: string;
  group: string;
  keywords: string[];
  src: string;
}

const logoGroups = [
  {
    key: 'logo.group.hotCoffee',
    ids: [
      'espresso', 'ristretto', 'americano', 'cappuccino', 'latte', 'turkish-coffee',
      'cortado', 'mocha', 'macchiato', 'flat-white', 'cafe-creme', 'decaf-coffee',
      'double-espresso',
    ],
  },
  {
    key: 'logo.group.coldDrinks',
    ids: [
      'iced-coffee', 'iced-latte', 'cold-brew', 'frappe', 'lemonade', 'orange-juice',
      'strawberry-juice', 'soda', 'cola', 'smoothie', 'milkshake', 'iced-tea',
      'sparkling-lemonade',
    ],
  },
  {
    key: 'logo.group.teaInfusions',
    ids: [
      'mint-tea', 'green-tea', 'black-tea', 'herbal-tea', 'chamomile-tea',
      'verbena-infusion', 'hibiscus-tea', 'lemon-tea', 'tea-pot',
    ],
  },
  {
    key: 'logo.group.waterBottles',
    ids: [
      'still-water', 'small-water-bottle', 'large-water-bottle', 'sparkling-water',
      'mineral-water', 'glass-of-water', 'flavored-water', 'water-jug',
    ],
  },
  {
    key: 'logo.group.pastryBakery',
    ids: [
      'croissant', 'almond-croissant', 'cake-slice', 'chocolate-cake', 'cookie',
      'chocolate-cookie', 'donut', 'baguette', 'brioche', 'pain-au-chocolat',
      'muffin', 'cinnamon-roll', 'fruit-tart',
    ],
  },
  {
    key: 'logo.group.food',
    ids: [
      'sandwich', 'tuna-sandwich', 'chicken-sandwich', 'pizza-slice', 'margherita-pizza',
      'burger', 'cheeseburger', 'fries', 'pasta', 'salad', 'crepe', 'omelette',
      'panini', 'quiche', 'wrap',
    ],
  },
  {
    key: 'logo.group.desserts',
    ids: [
      'ice-cream', 'vanilla-ice-cream', 'chocolate-ice-cream', 'waffle', 'tiramisu',
      'cheesecake', 'fruit-salad', 'pudding', 'brownie',
    ],
  },
  {
    key: 'logo.group.misc',
    ids: [
      'sugar', 'brown-sugar', 'milk', 'oat-milk', 'syrup', 'vanilla-syrup',
      'caramel-syrup', 'chocolate-syrup', 'honey', 'lemon', 'takeaway-cup', 'drinking-straw',
    ],
  },
] as const;

type LogoId = (typeof logoGroups)[number]['ids'][number];

const keywordAliases: Partial<Record<LogoId, string[]>> = {
  'turkish-coffee': ['qahwa', 'oriental coffee', 'strong coffee'],
  'cafe-creme': ['coffee with milk', 'creme coffee'],
  frappe: ['frappé', 'blended coffee', 'frozen coffee'],
  lemonade: ['citronnade', 'lemon drink'],
  'strawberry-juice': ['juice', 'strawberry'],
  'mint-tea': ['atay', 'nana', 'infusion'],
  'verbena-infusion': ['verveine', 'herbal tea'],
  baguette: ['bread', 'loaf'],
  'pain-au-chocolat': ['chocolate pastry', 'chocolatine'],
  fries: ['chips', 'french fries'],
  crepe: ['crêpe', 'sweet crepe'],
  'ice-cream': ['gelato', 'scoop'],
  'takeaway-cup': ['to go cup', 'paper cup'],
};

export const logoCatalog: LogoDefinition[] = logoGroups.flatMap(({ key, ids }) =>
  ids.map((id) => {
    const label = t(`logo.label.${id}`);
    return {
      id,
      label,
      group: t(key),
      keywords: [...new Set([label.toLocaleLowerCase(), ...label.toLocaleLowerCase().split(/[\s-]+/), ...(keywordAliases[id] ?? [])])],
      src: `/logos/${id}.svg`,
    };
  }),
);

export const logoGroupsList = logoGroups.map(({ key }) => t(key));

export function getLogoDefinition(id: string): LogoDefinition | undefined {
  return logoCatalog.find((logo) => logo.id === id);
}
