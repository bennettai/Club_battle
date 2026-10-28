// Simple, drawable things. Rounds draw from a shuffled bag so nothing repeats
// until every word has been used.
const WORDS = [
  "cat", "dog", "fish", "bird", "snake", "elephant", "giraffe", "turtle", "octopus", "spider",
  "rabbit", "penguin", "shark", "butterfly", "snail", "frog", "owl", "crab", "whale", "lion",
  "house", "castle", "lighthouse", "bridge", "tent", "igloo", "windmill", "pyramid", "skyscraper", "barn",
  "car", "bicycle", "rocket", "airplane", "boat", "train", "helicopter", "submarine", "tractor", "hot air balloon",
  "pizza", "banana", "ice cream", "cake", "burger", "apple", "carrot", "donut", "watermelon", "pineapple",
  "sun", "moon", "rainbow", "cloud", "tree", "flower", "mountain", "volcano", "island", "cactus",
  "umbrella", "glasses", "guitar", "piano", "clock", "lamp", "chair", "key", "scissors", "camera",
  "robot", "ghost", "dragon", "alien", "mermaid", "unicorn", "wizard", "pirate", "superhero", "snowman",
  "football", "trophy", "kite", "crown", "anchor", "light bulb", "headphones", "backpack", "toothbrush", "telescope",
  "spaceship", "treasure chest", "campfire", "waterfall", "dinosaur", "sandcastle", "skateboard", "balloon", "mushroom", "teapot",
];

let bag = [];

export function nextPrompt() {
  if (bag.length === 0) {
    bag = [...WORDS];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  return bag.pop();
}
