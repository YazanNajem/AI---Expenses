import logo from './assets/logo.png';

export default function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-backdrop"></div>
      <div className="loading-content">
        <div className="loading-logo">
          <img src={logo} alt="" className="loading-logo-base" />
          <img src={logo} alt="" className="loading-logo-fill" />
        </div>
        <div className="loading-text">VaultTrack</div>
        <div className="loading-bar-wrap">
          <div className="loading-bar-fill"></div>
        </div>
      </div>
    </div>
  );
}