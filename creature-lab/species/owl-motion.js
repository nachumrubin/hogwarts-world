// A fixed clock makes behavior and contact reproducible across frame rates.
export const owlFrame = 1 / 60;
const tau = Math.PI * 2;
const perched = new Set(['Perch', 'Look', 'Unfold', 'Fold']);
const airborne = new Set(['Fly', 'Glide', 'Bank']);
export const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));
export const ease = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
export const mix = (a, b, t) => a + (b - a) * t;
const angle = n => Math.atan2(Math.sin(n), Math.cos(n));
const bell = t => Math.sin(Math.PI * clamp(t)) ** 2;
const noise = n => { const x = Math.sin(n * 127.1 + 23.7) * 43758.5453; return x - Math.floor(x); };

function gaze(t) {
  // Events vary by block, with long intervals of still fixation.
  const block = Math.floor(t / 5), local = t - block * 5;
  const acquire = .60 + noise(block * 5) * .90, release = acquire + .8 + noise(block * 5 + 1) * 1.7;
  const hold = ease((local - acquire) / .19) * (1 - ease((local - release) / .33));
  const shift = bell((local - 2.55) / 1.38) * (noise(block * 5 + 2) - .5);
  return {
    yaw: hold * (noise(block * 5 + 3) - .5) * .62,
    pitch: hold * (noise(block * 5 + 4) - .55) * .16,
    tilt: hold * (noise(block * 5 + 6) - .5) * .11,
    shift
  };
}

export function owlBlink(t, side) {
  const block = Math.floor(t / 4.7);
  const onset = .42 + 3.24 * noise(block + 81);
  const age = t - block * 4.7 - onset - side * .014;
  const blink = (a, amount) => amount * ease(a / .068) * (1 - ease((a - .084) / .125));
  return Math.max(blink(age, 1), blink(age - .29, noise(block + 71) > .77 ? .76 : 0));
}

export class OwlMotion {
  constructor() {
    this.state = 'Perch';
    this.tick = 0;
    this.pending = 0;
    this.age = 0;
    this.route = 0;
    this.speed = 0;
    this.phase = 0;
    this.air = 0;
    this.open = 0;
    this.power = 0;
    this.glide = 0;
    this.bank = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.pose = {};
  }

  enter(state) {
    this.state = state;
    this.age = 0;
    if (state === 'Takeoff') {
      this.launchOpen = this.open;
      this.phase = 0;
    }
    if (state === 'Land') {
      this.approach = tau - this.route;
      if (this.approach < .36) this.approach += tau;
      this.approachSpeed = this.speed;
      this.approachDuration = clamp(this.approach / 1.75 + .55, 1.13, 2.38);
      this.approachAir = this.air;
      this.approachOpen = this.open;
    }
  }

  advance(dt, action, context, origin) {
    this.pending += Math.max(0, dt);
    while (this.pending >= owlFrame - 1e-10) {
      this.pending -= owlFrame;
      this.tick++;
      this.step(action, context, origin);
    }
    return this.pose;
  }

  step(action, context, origin) {
    if (this.state === 'Land') {
      if (this.age >= this.approachDuration + .60) {
        this.enter(perched.has(action) ? action : action === 'Land' ? 'Perch' : 'Takeoff');
      }
    } else if (this.state === 'Takeoff') {
      if (this.age >= .98 || (this.age >= .65 && (action === 'Land' || perched.has(action)))) {
        this.enter(airborne.has(action) ? action : action === 'Takeoff' ? 'Fly' : 'Land');
      }
    } else if (airborne.has(this.state)) {
      const next = action === 'Land' || perched.has(action) ? 'Land' : action === 'Takeoff' ? 'Fly' : action;
      if (next !== this.state) this.enter(next);
    } else if (airborne.has(action) || action === 'Takeoff') {
      this.enter('Takeoff');
    } else if (perched.has(action) && action !== this.state) {
      this.enter(action);
    }

    const state = this.state, launch = state === 'Takeoff', land = state === 'Land';
    const flight = airborne.has(state), t = this.tick * owlFrame, age = this.age;
    const approach = land ? clamp(age / this.approachDuration) : 0;
    const touchdownAge = land ? age - this.approachDuration : -1;
    const brake = land ? ease((approach - .32) / .58) * (1 - ease(touchdownAge / .30)) : 0;
    const blend = 1 - Math.exp(-owlFrame * 6);
    if (launch) {
      this.speed = 1.48 * ease((age - .35) / .54);
      this.air = ease((age - .29) / .64);
      this.open = mix(this.launchOpen, 1, ease((age - .12) / .46));
    } else if (land) {
      // Hermite distance curve meets the incoming velocity and ends at rest.
      const entry = Math.min(2.8, this.approachSpeed * this.approachDuration / this.approach);
      const elapsed = ease(approach) + entry * approach * (1 - approach) ** 2;
      this.route = approach === 1 ? 0 : (tau - this.approach * (1 - elapsed) + tau) % tau;
      this.air = this.approachAir * (1 - ease((approach - .43) / .57));
      this.open = mix(this.approachOpen, 1, ease(approach / .30)) * (1 - ease((touchdownAge - .12) / .45));
    } else {
      this.speed = flight ? mix(this.speed, state === 'Glide' ? 1.11 : 1.42, blend) : 0;
      this.air = flight ? mix(this.air, 1, blend) : 0;
      this.open = mix(this.open, Number(flight || state === 'Unfold'), blend);
    }
    if (flight || launch) this.route = (this.route + this.speed * owlFrame) % tau;

    // The roost circuit curves toward positive local X, so its inside
    // wing drops as the owl rolls into the turn.
    const bankTarget = state === 'Bank' ? -.43 * ease(age / .56) * (.70 + .30 * Math.sin(age * 1.6 + .4)) : 0;
    this.bank = mix(this.bank, bankTarget, blend);
    this.glide = mix(this.glide, Number(state === 'Glide' || state === 'Bank'), blend);
    const powered = state === 'Fly' ? 1 : launch ? ease((age - .26) / .24) : land ? .45 * (1 - ease((approach - .16) / .62)) : 0;
    this.power = mix(this.power, powered, 1 - Math.exp(-owlFrame * 8));
    const rate = mix(3.75, 3.50, this.air) + .12 * Math.sin(t * 1.05) + .075 * Math.sin(t * 2.7);
    this.phase += owlFrame * rate;
    const gait = gaze(t);
    const sight = state === 'Look' ? context.stimulus || context.playerPosition : null;
    let yaw = gait.yaw * (1 - this.air), pitch = gait.pitch * (1 - this.air);
    if (sight) {
      const dx = sight.x - origin.x, dz = sight.z - origin.z;
      // When nearly behind the bird, keep the existing rotation direction.
      const bearing = angle(Math.atan2(dx, dz) - this.route);
      const limit = 1.96;
      yaw = Math.abs(bearing) > 2.93 && Math.abs(this.yaw) > .65 ? Math.sign(this.yaw) * limit : clamp(bearing, -limit, limit);
      pitch = -clamp(Math.atan2(sight.y - origin.y - .24, Math.hypot(dx, dz)), -.36, .40);
    }
    const turn = 1 - Math.exp(-owlFrame * (sight ? 12 : 9));
    this.yaw = mix(this.yaw, yaw, turn);
    this.pitch = mix(this.pitch, pitch, turn);
    const crouch = launch ? .018 * bell((age - .035) / .34) - .016 * bell((age - .29) / .28) : 0;
    const settle = land ? .010 * bell(touchdownAge / .46) : 0;
    const wingbeat = Math.sin(tau * this.phase);
    const trim = .018 * Math.sin(t * 1.71) + .012 * Math.sin(t * 2.23 + .5);
    const perchWeight = (1 - this.air) * (1 - brake) * (1 - (launch ? ease(age / .24) : 0));
    Object.assign(this.pose, {
      t, state, age, approach, touchdownAge, brake, launch, land, phase: this.phase,
      route: this.route, air: this.air, open: this.open, power: this.power, glide: this.glide, bank: this.bank, trim,
      breath: perchWeight * Math.sin(t * 2 + .22 * Math.sin(t * .57)),
      shift: gait.shift * perchWeight, tilt: gait.tilt * (1 - this.air), yaw: this.yaw, pitch: this.pitch,
      crouch, settle, bounce: wingbeat * this.power * this.air
    });
    this.age += owlFrame;
  }
}

export function owlStroke(phase) {
  const cycle = phase - Math.floor(phase);
  // A shorter loaded downstroke and a longer, flexed recovery.
  const change = .43, down = cycle < change;
  const u = down ? cycle / change : (cycle - change) / (1 - change);
  const stroke = down ? mix(.66, -.53, ease(u)) : mix(-.53, .66, ease(u));
  return {stroke, recovery: down ? 0 : bell(u), load: (down ? 1 : -.46) * bell(u)};
}
