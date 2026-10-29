// Local exercise catalog for the routine editor.
// These names are not inserted into the database. Choosing one that is not
// already in the saved library stays on this screen.

export const CATALOG_TARGET_MIN = 300;
export const CATALOG_TARGET_MAX = 500;

export const CUSTOM_EXERCISE_WRITES_ENABLED = false;

export const CUSTOM_EXERCISE_PLAN = {
  writesEnabled: false,
  sharedCatalog:
    'The shared exercise library stays select-only. Missing standard names need a reviewed insert of new rows only, never an update of an existing id.',
  ownership:
    'A custom exercise would be a new row owned by auth.uid(). Other accounts would not be able to read or change it.',
  permissions:
    'A later reviewed migration would add owner-only insert, update, and delete. It would not grant those writes on the shared library.',
  history:
    'Workout history stores exercise ids. A custom exercise needs its own id and must not rename or reuse an id that existing sets already use.',
  notInThisChange:
    'No table, policy, grant, or insert is included. A typed custom name stays on this screen until that migration is approved.',
} as const;

export const MUSCLE_GROUPS = [
  'Chest',
  'Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Forearms',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Core',
  'Cardio',
  'Full body',
] as const;

export const EQUIPMENT_TYPES = [
  'Barbell',
  'Dumbbell',
  'Machine',
  'Cable',
  'Bodyweight',
  'Kettlebell',
  'Band',
  'Cardio',
] as const;

export type CatalogMuscle = (typeof MUSCLE_GROUPS)[number];
export type CatalogEquipment = (typeof EQUIPMENT_TYPES)[number];

export type PlannedExercise = {
  name: string;
  muscle: CatalogMuscle;
  equipment: CatalogEquipment;
};

const MUSCLE_BY_CATEGORY: Record<string, CatalogMuscle> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  shoulder: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  forearm: 'Forearms',
  quads: 'Quads',
  quadriceps: 'Quads',
  hamstrings: 'Hamstrings',
  hamstring: 'Hamstrings',
  glutes: 'Glutes',
  glute: 'Glutes',
  calves: 'Calves',
  calf: 'Calves',
  core: 'Core',
  abs: 'Core',
  abdominals: 'Core',
  cardio: 'Cardio',
  'full body': 'Full body',
  fullbody: 'Full body',
};

const EQUIPMENT_BY_TYPE: Record<string, CatalogEquipment> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  bodyweight: 'Bodyweight',
  kettlebell: 'Kettlebell',
  band: 'Band',
  cardio: 'Cardio',
};

export function normalizeExerciseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function muscleFromCategory(category: unknown): CatalogMuscle | null {
  if (typeof category !== 'string') {
    return null;
  }
  return MUSCLE_BY_CATEGORY[normalizeExerciseName(category)] ?? null;
}

export function equipmentFromType(equipment: unknown): CatalogEquipment | null {
  if (typeof equipment !== 'string') {
    return null;
  }
  return EQUIPMENT_BY_TYPE[normalizeExerciseName(equipment)] ?? null;
}

function add(
  muscle: CatalogMuscle,
  equipment: CatalogEquipment,
  names: readonly string[],
): PlannedExercise[] {
  return names.map((name) => ({ name, muscle, equipment }));
}

export const PLANNED_EXERCISES: readonly PlannedExercise[] = [
  ...add('Chest', 'Barbell', [
    'Barbell Bench Press',
    'Pause Barbell Bench Press',
    'Close-Grip Bench Press',
    'Wide-Grip Bench Press',
    'Incline Barbell Bench Press',
    'Decline Barbell Bench Press',
    'Barbell Floor Press',
    'Reverse-Grip Bench Press',
    'Barbell Guillotine Press',
    'Spoto Press',
  ]),
  ...add('Chest', 'Dumbbell', [
    'Dumbbell Bench Press',
    'Incline Dumbbell Bench Press',
    'Decline Dumbbell Bench Press',
    'Dumbbell Floor Press',
    'Dumbbell Fly',
    'Incline Dumbbell Fly',
    'Decline Dumbbell Fly',
    'Dumbbell Squeeze Press',
    'Dumbbell Pullover',
    'Hex Press',
  ]),
  ...add('Chest', 'Machine', [
    'Machine Chest Press',
    'Incline Machine Chest Press',
    'Decline Machine Chest Press',
    'Pec Deck Fly',
    'Machine Fly',
    'Seated Chest Press',
  ]),
  ...add('Chest', 'Cable', [
    'Cable Fly',
    'High Cable Fly',
    'Low Cable Fly',
    'Cable Crossover',
    'Incline Cable Fly',
    'Standing Cable Chest Press',
    'Single-Arm Cable Fly',
  ]),
  ...add('Chest', 'Bodyweight', [
    'Push-Up',
    'Incline Push-Up',
    'Decline Push-Up',
    'Diamond Push-Up',
    'Wide Push-Up',
    'Archer Push-Up',
    'Pike Push-Up',
    'Clap Push-Up',
    'Feet-Elevated Push-Up',
  ]),
  ...add('Back', 'Barbell', [
    'Barbell Bent-Over Row',
    'Pendlay Row',
    'Yates Row',
    'Underhand Barbell Row',
    'Meadows Row',
    'Chest-Supported Barbell Row',
    'Barbell Shrug',
    'Rack Pull',
    'Conventional Deadlift',
    'Snatch-Grip Deadlift',
  ]),
  ...add('Back', 'Dumbbell', [
    'Single-Arm Dumbbell Row',
    'Chest-Supported Dumbbell Row',
    'Dumbbell Bent-Over Row',
    'Dumbbell Seal Row',
    'Renegade Row',
    'Dumbbell Shrug',
    'Dumbbell Pullover for Back',
    'Incline Dumbbell Row',
  ]),
  ...add('Back', 'Machine', [
    'Machine Row',
    'Chest-Supported Machine Row',
    'Lat Pulldown',
    'Neutral-Grip Lat Pulldown',
    'Wide-Grip Lat Pulldown',
    'Assisted Pull-Up',
    'Machine Pullover',
    'T-Bar Row Machine',
  ]),
  ...add('Back', 'Cable', [
    'Seated Cable Row',
    'Wide-Grip Seated Cable Row',
    'Single-Arm Cable Row',
    'Straight-Arm Pulldown',
    'Face Pull',
    'Cable Shrug',
    'Half-Kneeling Cable Row',
    'Rope Straight-Arm Pulldown',
  ]),
  ...add('Back', 'Bodyweight', [
    'Pull-Up',
    'Chin-Up',
    'Neutral-Grip Pull-Up',
    'Wide-Grip Pull-Up',
    'Inverted Row',
    'Commando Pull-Up',
    'Archer Pull-Up',
  ]),
  ...add('Shoulders', 'Barbell', [
    'Overhead Press',
    'Push Press',
    'Behind-the-Neck Press',
    'Barbell Upright Row',
    'Barbell Front Raise',
    'Landmine Press',
    'Z Press',
  ]),
  ...add('Shoulders', 'Dumbbell', [
    'Seated Dumbbell Shoulder Press',
    'Standing Dumbbell Shoulder Press',
    'Arnold Press',
    'Dumbbell Lateral Raise',
    'Dumbbell Front Raise',
    'Bent-Over Dumbbell Reverse Fly',
    'Dumbbell Y Raise',
    'Dumbbell Shrug to Press',
    'Cuban Press',
  ]),
  ...add('Shoulders', 'Machine', [
    'Machine Shoulder Press',
    'Machine Lateral Raise',
    'Reverse Pec Deck',
    'Smith Machine Shoulder Press',
  ]),
  ...add('Shoulders', 'Cable', [
    'Cable Lateral Raise',
    'Cable Front Raise',
    'Cable Reverse Fly',
    'Cable Upright Row',
    'Single-Arm Cable Press',
    'Cross-Body Cable Raise',
  ]),
  ...add('Shoulders', 'Bodyweight', [
    'Handstand Hold',
    'Wall Walk',
    'Pike Shoulder Press',
    'Elevated Pike Push-Up',
    'Pseudo Planche Push-Up',
  ]),
  ...add('Biceps', 'Barbell', [
    'Barbell Curl',
    'EZ-Bar Curl',
    'Wide-Grip Barbell Curl',
    'Drag Curl',
    'Preacher Barbell Curl',
    'Reverse Barbell Curl',
  ]),
  ...add('Biceps', 'Dumbbell', [
    'Dumbbell Curl',
    'Alternating Dumbbell Curl',
    'Hammer Curl',
    'Incline Dumbbell Curl',
    'Concentration Curl',
    'Cross-Body Hammer Curl',
    'Zottman Curl',
    'Seated Dumbbell Curl',
  ]),
  ...add('Biceps', 'Machine', [
    'Machine Preacher Curl',
    'Machine Biceps Curl',
    'Spider Curl Machine',
  ]),
  ...add('Biceps', 'Cable', [
    'Cable Curl',
    'Rope Hammer Curl',
    'High Cable Curl',
    'Single-Arm Cable Curl',
    'Bayesian Cable Curl',
    'Overhead Cable Curl',
  ]),
  ...add('Biceps', 'Bodyweight', ['Chin-Up Hold', 'Towel Curl', 'Inverted Curl']),
  ...add('Triceps', 'Barbell', [
    'Close-Grip Floor Press',
    'EZ-Bar Skull Crusher',
    'Barbell Skull Crusher',
    'JM Press',
  ]),
  ...add('Triceps', 'Dumbbell', [
    'Dumbbell Skull Crusher',
    'Overhead Dumbbell Extension',
    'Single-Arm Overhead Dumbbell Extension',
    'Dumbbell Kickback',
    'Tate Press',
  ]),
  ...add('Triceps', 'Machine', [
    'Machine Triceps Extension',
    'Machine Dip',
    'Seated Triceps Press',
  ]),
  ...add('Triceps', 'Cable', [
    'Cable Pressdown',
    'Rope Pressdown',
    'Overhead Cable Extension',
    'Single-Arm Cable Pressdown',
    'Reverse-Grip Pressdown',
    'Cable Kickback',
  ]),
  ...add('Triceps', 'Bodyweight', [
    'Bench Dip',
    'Parallel Bar Dip',
    'Straight Bar Dip',
    'Close-Grip Push-Up',
    'Bodyweight Skull Crusher',
  ]),
  ...add('Forearms', 'Barbell', [
    'Barbell Wrist Curl',
    'Barbell Reverse Wrist Curl',
    'Behind-the-Back Wrist Curl',
  ]),
  ...add('Forearms', 'Dumbbell', [
    'Dumbbell Wrist Curl',
    'Dumbbell Reverse Wrist Curl',
    'Farmer Hold',
    'Dumbbell Pronation',
  ]),
  ...add('Forearms', 'Cable', ['Cable Wrist Curl', 'Cable Reverse Wrist Curl', 'Towel Cable Row']),
  ...add('Forearms', 'Bodyweight', ['Dead Hang', 'Active Hang', 'Plate Pinch Hold']),
  ...add('Quads', 'Barbell', [
    'Back Squat',
    'Pause Back Squat',
    'Front Squat',
    'Box Squat',
    'Hack Squat with Barbell',
    'Zercher Squat',
    'Barbell Lunge',
    'Barbell Step-Up',
    'Anderson Squat',
    'Safety Bar Squat',
  ]),
  ...add('Quads', 'Dumbbell', [
    'Goblet Squat',
    'Dumbbell Lunge',
    'Dumbbell Walking Lunge',
    'Dumbbell Split Squat',
    'Dumbbell Step-Up',
    'Dumbbell Bulgarian Split Squat',
  ]),
  ...add('Quads', 'Machine', [
    'Leg Press',
    'Hack Squat',
    'Pendulum Squat',
    'Leg Extension',
    'Single-Leg Press',
    'Smith Machine Squat',
    'Belt Squat',
  ]),
  ...add('Quads', 'Bodyweight', [
    'Air Squat',
    'Split Squat',
    'Reverse Lunge',
    'Forward Lunge',
    'Walking Lunge',
    'Sissy Squat',
    'Pistol Squat',
    'Shrimp Squat',
  ]),
  ...add('Hamstrings', 'Barbell', [
    'Romanian Deadlift',
    'Stiff-Leg Deadlift',
    'Good Morning',
    'Barbell Hip Hinge',
    'Single-Leg Romanian Deadlift',
  ]),
  ...add('Hamstrings', 'Dumbbell', [
    'Dumbbell Romanian Deadlift',
    'Single-Leg Dumbbell Romanian Deadlift',
    'Dumbbell Good Morning',
    'Dumbbell Leg Curl',
  ]),
  ...add('Hamstrings', 'Machine', [
    'Lying Leg Curl',
    'Seated Leg Curl',
    'Standing Leg Curl',
    'Glute-Ham Raise',
  ]),
  ...add('Hamstrings', 'Bodyweight', [
    'Nordic Hamstring Curl',
    'Sliding Leg Curl',
    'Single-Leg Sliding Leg Curl',
  ]),
  ...add('Glutes', 'Barbell', [
    'Barbell Hip Thrust',
    'Barbell Glute Bridge',
    'Sumo Deadlift',
    'Curtsy Lunge with Barbell',
    'Barbell Reverse Lunge',
    'Kas Glute Bridge',
  ]),
  ...add('Glutes', 'Dumbbell', [
    'Dumbbell Hip Thrust',
    'Dumbbell Glute Bridge',
    'Curtsy Lunge',
    'Lateral Lunge',
    'Dumbbell Frog Pump',
  ]),
  ...add('Glutes', 'Machine', [
    'Machine Hip Thrust',
    'Abductor Machine',
    'Adductor Machine',
    'Glute Kickback Machine',
  ]),
  ...add('Glutes', 'Cable', [
    'Cable Pull-Through',
    'Cable Glute Kickback',
    'Cable Hip Abduction',
    'Cable Hip Adduction',
  ]),
  ...add('Glutes', 'Bodyweight', [
    'Glute Bridge',
    'Single-Leg Glute Bridge',
    'Frog Pump',
    'Donkey Kick',
    'Fire Hydrant',
    'Step-Up',
  ]),
  ...add('Calves', 'Barbell', ['Standing Barbell Calf Raise', 'Seated Barbell Calf Raise']),
  ...add('Calves', 'Dumbbell', [
    'Standing Dumbbell Calf Raise',
    'Single-Leg Dumbbell Calf Raise',
    'Farmer Carry Calf Raise',
  ]),
  ...add('Calves', 'Machine', [
    'Standing Calf Raise Machine',
    'Seated Calf Raise Machine',
    'Leg Press Calf Raise',
    'Donkey Calf Raise',
  ]),
  ...add('Calves', 'Bodyweight', [
    'Bodyweight Calf Raise',
    'Single-Leg Calf Raise',
    'Jump Rope Calf Bounce',
  ]),
  ...add('Core', 'Cable', [
    'Cable Crunch',
    'Cable Woodchop',
    'Pallof Press',
    'Cable Dead Bug',
    'High-to-Low Woodchop',
  ]),
  ...add('Core', 'Machine', ['Ab Crunch Machine', 'Torso Rotation Machine', 'Captain Chair Knee Raise']),
  ...add('Core', 'Bodyweight', [
    'Plank',
    'Side Plank',
    'Dead Bug',
    'Bird Dog',
    'Crunch',
    'Bicycle Crunch',
    'Leg Raise',
    'Hanging Knee Raise',
    'Hanging Leg Raise',
    'Mountain Climber',
    'V-Up',
    'Hollow Hold',
    'Ab Wheel Rollout',
    'Sit-Up',
    'Reverse Crunch',
    'Toe Touch',
  ]),
  ...add('Cardio', 'Cardio', [
    'Treadmill Walk',
    'Treadmill Run',
    'Incline Treadmill Walk',
    'Stationary Bike',
    'Air Bike',
    'Rowing Machine',
    'SkiErg',
    'Elliptical',
    'Stair Climber',
    'Jump Rope',
    'Sprint Intervals',
    'Easy Spin',
  ]),
  ...add('Cardio', 'Bodyweight', [
    'Jumping Jack',
    'Burpee',
    'High Knees',
    'Butt Kick',
    'Shadow Boxing',
    'Bear Crawl',
    'Inchworm',
  ]),
  ...add('Full body', 'Barbell', [
    'Power Clean',
    'Hang Power Clean',
    'Power Snatch',
    'Clean and Jerk',
    'Thruster',
    'Barbell Complex Deadlift to Row',
    'Push Jerk',
  ]),
  ...add('Full body', 'Dumbbell', [
    'Dumbbell Thruster',
    'Dumbbell Clean',
    'Dumbbell Snatch',
    'Dumbbell Devil Press',
    'Man Maker',
  ]),
  ...add('Full body', 'Kettlebell', [
    'Kettlebell Swing',
    'Kettlebell Goblet Squat',
    'Kettlebell Clean',
    'Kettlebell Snatch',
    'Kettlebell Press',
    'Kettlebell Turkish Get-Up',
    'Kettlebell Windmill',
    'Kettlebell Halo',
    'Double Kettlebell Front Squat',
    'Kettlebell Row',
  ]),
  ...add('Full body', 'Bodyweight', [
    'Bear Complex',
    'Sprawl',
    'Squat Thrust',
    'Burpee Broad Jump',
    'Crawl',
    'Turkish Sit-Up',
  ]),
  ...add('Chest', 'Band', ['Band Chest Press', 'Band Fly', 'Band Push-Up']),
  ...add('Back', 'Band', ['Band Pull-Apart', 'Band Row', 'Band Straight-Arm Pulldown', 'Band Face Pull']),
  ...add('Shoulders', 'Band', ['Band Lateral Raise', 'Band Shoulder Press', 'Band Pull-Apart High']),
  ...add('Biceps', 'Band', ['Band Curl', 'Band Hammer Curl']),
  ...add('Triceps', 'Band', ['Band Pressdown', 'Band Overhead Extension']),
  ...add('Quads', 'Band', ['Band Squat', 'Band Split Squat', 'Band Leg Extension']),
  ...add('Hamstrings', 'Band', ['Band Romanian Deadlift', 'Band Leg Curl']),
  ...add('Glutes', 'Band', ['Band Hip Thrust', 'Band Glute Kickback', 'Band Lateral Walk']),
  ...add('Core', 'Band', ['Band Pallof Press', 'Band Woodchop']),
  ...add('Chest', 'Kettlebell', ['Kettlebell Floor Press', 'Kettlebell Fly']),
  ...add('Shoulders', 'Kettlebell', ['Kettlebell Halo Press', 'Bottoms-Up Kettlebell Press']),
  ...add('Quads', 'Kettlebell', ['Kettlebell Front Squat', 'Kettlebell Reverse Lunge']),
  ...add('Hamstrings', 'Kettlebell', ['Kettlebell Romanian Deadlift']),
  ...add('Glutes', 'Kettlebell', ['Kettlebell Swing to Squat', 'Kettlebell Hip Thrust']),
  ...add('Core', 'Kettlebell', ['Kettlebell Around the World', 'Kettlebell Sit-Up']),
  ...add('Forearms', 'Kettlebell', ['Kettlebell Farmer Carry', 'Bottoms-Up Carry']),
  ...add('Back', 'Kettlebell', ['Kettlebell Gorilla Row', 'Single-Arm Kettlebell Row']),
  ...add('Calves', 'Band', ['Band Calf Raise']),
  ...add('Full body', 'Band', ['Band Thruster']),
  ...add('Cardio', 'Kettlebell', ['Kettlebell Swing Intervals']),
];
