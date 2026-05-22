// Event Filtering
document.addEventListener('DOMContentLoaded', function() {
    const filterButtons = document.querySelectorAll('.filter-btn');
    const allCards = document.querySelectorAll('.event-card, .featured-card');
    const featuredSection = document.querySelector('.featured-event');

    filterButtons.forEach(button => {
        button.addEventListener('click', function() {
            filterButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');

            const filterValue = this.getAttribute('data-filter');

            allCards.forEach(card => {
                if (filterValue === 'all') {
                    card.classList.remove('hidden');
                } else {
                    const cardCategories = card.getAttribute('data-category').split(' ');
                    if (cardCategories.includes(filterValue)) {
                        card.classList.remove('hidden');
                    } else {
                        card.classList.add('hidden');
                    }
                }
            });

            // Hide featured section if all its cards are filtered out
            if (featuredSection) {
                const visibleFeatured = featuredSection.querySelectorAll('.featured-card:not(.hidden)');
                featuredSection.classList.toggle('hidden', visibleFeatured.length === 0);
            }
        });
    });
    
    // Newsletter form submission
    const newsletterForm = document.querySelector('.newsletter-form');
    if (newsletterForm) {
        newsletterForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const email = this.querySelector('.newsletter-input').value;
            // Add your newsletter signup logic here
            alert('Thank you for subscribing! You\'ll receive updates about our events.');
            this.reset();
        });
    }
    
});
