import React, { useRef, useEffect } from 'react';
import { usePluginContext } from '../contexts/PluginContext';

export function SearchBar() {
  const { state, setSearchQuery } = usePluginContext();
  const inputRef = useRef(null);

  // Handle search input change
  const handleChange = (e) => {
    setSearchQuery(e.target.value);
  };

  // Handle Escape key to clear search
  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && state.searchQuery) {
      e.stopPropagation(); // Prevent closing the Plugin Hub
      setSearchQuery('');
    }
  };

  // Focus method for external use
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focusSearch = () => {
        inputRef.current.focus();
      };
    }
  }, []);

  return (
    <div className="search-bar-container">
      <input
        ref={inputRef}
        type="search"
        role="search"
        aria-label="Search plugins"
        placeholder="Search plugins..."
        value={state.searchQuery}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="search-input"
      />
    </div>
  );
}