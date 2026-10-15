import * as THREE from 'three';
import { battingDisplay } from './Batting.js';

/** One persistent texture; uploads only when visible score/statistics change. */
export class StadiumScoreboard {
  constructor(ballsPerOver = 6) {
    this.ballsPerOver = ballsPerOver;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 512;
    this.context = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.updates = 0;
  }

  update(state) {
    const data = battingDisplay(state, this.ballsPerOver);
    const key = JSON.stringify(data);
    if (key === this.key) return false;
    this.key = key;
    this.data = data;
    this.updates++;
    const c = this.context;
    c.fillStyle = '#071c20'; c.fillRect(0, 0, 1024, 512);
    c.textAlign = 'left';
    c.fillStyle = '#93bcb5'; c.font = 'bold 28px Arial';
    c.fillText(data.target == null ? 'CREASE OVAL  /  LIVE INNINGS'
      : `CREASE OVAL  /  TARGET ${data.target}  /  NEED ${Math.max(0, data.target - data.score)}`, 44, 49);
    c.fillStyle = '#deef9b'; c.font = 'bold 116px Arial';
    c.fillText(`${data.score} / ${data.wickets}`, 40, 172);
    c.fillStyle = '#e9efea'; c.font = 'bold 36px Arial'; c.textAlign = 'right';
    c.fillText(`${data.overs} OVERS`, 980, 132);
    c.fillStyle = '#3b6664'; c.fillRect(44, 202, 936, 2);
    c.textAlign = 'left'; c.fillStyle = '#93bcb5'; c.font = '24px Arial';
    c.fillText('BATTER', 44, 246);
    c.textAlign = 'right';
    for (const [text, x] of [['R', 625], ['B', 728], ['4 / 6', 854], ['SR', 980]]) c.fillText(text, x, 246);
    data.batsmen.forEach((batter, index) => {
      const y = 310 + index * 79;
      c.fillStyle = batter.out ? '#b99994' : batter.striker ? '#deef9b' : '#e9efea';
      c.font = 'bold 32px Arial'; c.textAlign = 'left';
      c.fillText(`${batter.name}${batter.out ? ' OUT' : batter.striker ? ' *' : ''}`, 44, y, 490);
      c.textAlign = 'right';
      for (const [text, x] of [[batter.runs, 625], [batter.balls, 728],
        [`${batter.fours} / ${batter.sixes}`, 854], [batter.strikeRate, 980]]) c.fillText(String(text), x, y);
    });
    c.fillStyle = '#93bcb5'; c.textAlign = 'left'; c.font = '22px Arial';
    c.fillText('* ON STRIKE     R RUNS / B BALLS / SR STRIKE RATE', 44, 465);
    this.texture.needsUpdate = true;
    return true;
  }
}
